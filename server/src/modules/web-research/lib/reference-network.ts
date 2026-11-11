/**
 * The only way a rendered reference page reaches the network.
 *
 * Chromium's own stack is never used for a page's traffic: Playwright does not
 * call route handlers for redirect hops, so `route.continue()` would let a
 * public URL 302 to an internal one unseen. Each request is instead intercepted
 * and performed from Node, one hop at a time. That also makes the address
 * check exact: the check happens inside the connection's own DNS lookup, so the
 * address verified is the address connected to, and a host that rebinds to
 * 169.254.169.254 between check and use fails.
 */
import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';

import { isPrivateAddress, isSafeResearchUrl } from './url-safety.js';

export const MAX_REDIRECT_HOPS = 5;

export class ReferenceNetworkError extends Error {
  constructor(
    readonly kind: 'unsafe' | 'too-large' | 'too-many-redirects' | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'ReferenceNetworkError';
  }
}

export interface HopRequest {
  url: string;
  headers: Readonly<Record<string, string>>;
  maxBytes: number;
  timeoutMs: number;
}

export interface HopResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Buffer;
}

/** One HTTP exchange, with no redirect following of its own. */
export type HopTransport = (request: HopRequest) => Promise<HopResponse>;

export type AddressResolver = (hostname: string) => Promise<readonly string[]>;

export const systemResolver: AddressResolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (error, addresses: LookupAddress[]) => {
      if (error) reject(error);
      else resolve(addresses.map((entry) => entry.address));
    });
  });

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A `lookup` for `http.request`. One public address beside a private one is
 * still a refusal: which of them gets connected to is not ours to choose.
 */
export function guardedLookup(resolver: AddressResolver = systemResolver) {
  return (
    hostname: string,
    options: { all?: boolean | undefined },
    callback: LookupCallback,
  ): void => {
    resolver(hostname).then(
      (addresses) => {
        const blocked = addresses.length === 0 || addresses.some(isPrivateAddress);
        if (blocked) {
          const error: NodeJS.ErrnoException = new ReferenceNetworkError(
            'unsafe',
            'the host resolves to a private or unusable address',
          );
          callback(error, '');
          return;
        }
        const entries = addresses.map((address) => ({
          address,
          family: address.includes(':') ? 6 : 4,
        }));
        if (options.all === true) callback(null, entries);
        else callback(null, entries[0]?.address ?? '', entries[0]?.family ?? 4);
      },
      (error: unknown) => {
        callback(error as NodeJS.ErrnoException, '');
      },
    );
  };
}

function flatten(headers: http.IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) flat[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return flat;
}

/** Counts decompressed bytes, so a small gzip bomb hits the same limit as a big file. */
function decoded(response: http.IncomingMessage): Readable {
  switch (response.headers['content-encoding']) {
    case 'gzip':
      return response.pipe(zlib.createGunzip());
    case 'deflate':
      return response.pipe(zlib.createInflate());
    case 'br':
      return response.pipe(zlib.createBrotliDecompress());
    default:
      return response;
  }
}

function asNetworkError(error: unknown): ReferenceNetworkError {
  if (error instanceof ReferenceNetworkError) return error;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return new ReferenceNetworkError('network', code ?? 'the request failed');
}

export interface NodeTransport {
  transport: HopTransport;
  /** Drops pooled sockets, so a finished render leaves no connection open. */
  close: () => void;
}

export function createNodeTransport(resolver: AddressResolver = systemResolver): NodeTransport {
  const lookup = guardedLookup(resolver);
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8 });
  const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8 });

  const transport: HopTransport = (hop) =>
    new Promise((resolve, reject) => {
      const url = new URL(hop.url);
      const isTls = url.protocol === 'https:';
      const client = isTls ? https : http;
      const request = client.request(url, {
        method: 'GET',
        headers: hop.headers,
        agent: isTls ? httpsAgent : httpAgent,
        lookup,
      });
      // Wall clock, not idle time: a page can trickle bytes forever otherwise.
      const timer = setTimeout(() => {
        request.destroy(new ReferenceNetworkError('network', 'timed out'));
      }, hop.timeoutMs);
      const fail = (error: unknown): void => {
        clearTimeout(timer);
        reject(asNetworkError(error));
      };

      request.on('error', fail);
      request.on('response', (response) => {
        const status = response.statusCode ?? 0;
        const headers = flatten(response.headers);
        const done = (body: Buffer): void => {
          clearTimeout(timer);
          resolve({ status, headers, body });
        };
        if (status >= 300 && status < 400) {
          response.resume();
          done(Buffer.alloc(0));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        const stream = decoded(response);
        stream.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > hop.maxBytes) {
            request.destroy(new ReferenceNetworkError('too-large', 'the response was too large'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => {
          done(Buffer.concat(chunks));
        });
        stream.on('error', fail);
        response.on('error', fail);
      });
      request.end();
    });

  return {
    transport,
    close: () => {
      httpAgent.destroy();
      httpsAgent.destroy();
    },
  };
}

export interface GuardedResponse extends HopResponse {
  finalUrl: string;
}

/** Follows redirects itself, so every hop is vetted before anything connects to it. */
export async function guardedFetch(
  transport: HopTransport,
  url: string,
  options: Omit<HopRequest, 'url'>,
): Promise<GuardedResponse> {
  const deadline = Date.now() + options.timeoutMs;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    if (!isSafeResearchUrl(current)) {
      throw new ReferenceNetworkError('unsafe', 'it led to a refused address');
    }
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) throw new ReferenceNetworkError('network', 'timed out');
    const response = await transport({ ...options, url: current, timeoutMs });
    const location = response.headers.location;
    if (response.status < 300 || response.status >= 400 || location === undefined) {
      return { ...response, finalUrl: current };
    }
    try {
      current = new URL(location, current).toString();
    } catch {
      throw new ReferenceNetworkError('network', 'it redirected to a malformed address');
    }
  }
  throw new ReferenceNetworkError('too-many-redirects', 'it redirected too many times');
}

export interface RouteRequestLike {
  url(): string;
  method(): string;
  resourceType(): string;
  headers(): Record<string, string>;
}

export interface RouteLike {
  request(): RouteRequestLike;
  abort(errorCode?: string): Promise<void>;
  fulfill(response: {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  }): Promise<void>;
}

/** Spent by one render. Shared across its requests, so a page cannot fan out around it. */
export interface RenderBudget {
  requestsLeft: number;
  bytesLeft: number;
  /** Set when a limit, not the page, is why something did not load. */
  exhausted: boolean;
}

/** Anything else (media, beacons, manifests) adds exposure and nothing to the layout. */
const FETCHED_RESOURCE_TYPES = new Set([
  'document',
  'stylesheet',
  'script',
  'image',
  'font',
  'xhr',
  'fetch',
]);

/** `set-cookie` is absent on purpose, which is what keeps a render cookie-free. */
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'access-control-allow-origin',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-expose-headers',
  'timing-allow-origin',
];

const DOWNLOAD_CONTENT_TYPE =
  /^application\/(octet-stream|zip|gzip|x-[a-z0-9.-]*(compress|tar|msdownload|sh|executable)[a-z0-9.-]*)/i;

function isDownload(headers: Readonly<Record<string, string>>): boolean {
  if (/attachment/i.test(headers['content-disposition'] ?? '')) return true;
  return DOWNLOAD_CONTENT_TYPE.test(headers['content-type'] ?? '');
}

export interface RouteGuardOptions {
  transport: HopTransport;
  userAgent: string;
  budget: RenderBudget;
  maxResponseBytes: number;
  requestTimeoutMs: number;
}

export function createRouteGuard(options: RouteGuardOptions) {
  const { budget, transport, userAgent } = options;
  const abort = async (route: RouteLike): Promise<void> => {
    // Rejects once the page is closed, which is an ordinary end to a render.
    await route.abort('blockedbyclient').catch(() => undefined);
  };

  return async (route: RouteLike): Promise<void> => {
    const request = route.request();
    if (
      !isSafeResearchUrl(request.url()) ||
      request.method() !== 'GET' ||
      !FETCHED_RESOURCE_TYPES.has(request.resourceType())
    ) {
      await abort(route);
      return;
    }
    if (budget.requestsLeft <= 0 || budget.bytesLeft <= 0) {
      budget.exhausted = true;
      await abort(route);
      return;
    }
    budget.requestsLeft -= 1;

    const incoming = request.headers();
    const maxBytes = Math.min(options.maxResponseBytes, budget.bytesLeft);
    try {
      const response = await guardedFetch(transport, request.url(), {
        headers: {
          'user-agent': userAgent,
          accept: incoming.accept ?? '*/*',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'en-US,en;q=0.9',
          ...(incoming.origin === undefined ? {} : { origin: incoming.origin }),
          ...(incoming.referer === undefined ? {} : { referer: incoming.referer }),
        },
        maxBytes,
        timeoutMs: options.requestTimeoutMs,
      });
      budget.bytesLeft -= response.body.length;
      if (isDownload(response.headers)) {
        await abort(route);
        return;
      }
      const headers: Record<string, string> = {};
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = response.headers[name];
        if (value !== undefined) headers[name] = value;
      }
      await route.fulfill({ status: response.status, headers, body: response.body });
    } catch (error) {
      if (error instanceof ReferenceNetworkError && error.kind === 'too-large') {
        budget.bytesLeft -= maxBytes;
        budget.exhausted = true;
      }
      await abort(route);
    }
  };
}
