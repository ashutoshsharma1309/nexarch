/**
 * Which URLs research may hand to an extraction provider.
 *
 * URLs here come from search results and from users, so they are untrusted.
 * This module never fetches a page itself, but a third party fetching an
 * internal address on request is still a bad address to pass along.
 */
import { createHash } from 'node:crypto';

const MAX_URL_LENGTH = 2048;

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
];

const BLOCKED_EXTENSIONS = new Set([
  // Executables and installers.
  'exe',
  'msi',
  'dmg',
  'pkg',
  'deb',
  'rpm',
  'apk',
  'app',
  'bat',
  'cmd',
  'sh',
  'ps1',
  'jar',
  'bin',
  'scr',
  'vbs',
  'dll',
  'so',
  // Archives and disk images.
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'iso',
  'img',
]);

const TRACKING_PARAM = /^(utm_.+|gclid|fbclid|msclkid|mc_cid|mc_eid|ref_src)$/i;

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Dotted-quad octets, or null. `URL` has already rewritten decimal and hex hosts to this form. */
function parseIpv4(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** Eight hextets from an address without brackets, or null when it is malformed. */
function parseIpv6(host: string): number[] | null {
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const toHextets = (part: string | undefined): number[] =>
    part ? part.split(':').map((hextet) => Number.parseInt(hextet, 16)) : [];
  const head = toHextets(halves[0]);
  const tail = toHextets(halves[1]);
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  return missing < 0 ? null : [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function embeddedIpv4(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isPrivateIpv6(host: string): boolean {
  const parts = parseIpv6(host);
  // Refused rather than guessed at: nothing valid should fail to parse here.
  if (!parts || parts.some((part) => Number.isNaN(part))) return true;
  const [h0 = 0, h1 = 0, h2 = 0, , , h5 = 0, h6 = 0, h7 = 0] = parts;

  if ((h0 & 0xfe00) === 0xfc00) return true;
  if ((h0 & 0xffc0) === 0xfe80) return true;
  if ((h0 & 0xffc0) === 0xfec0) return true;
  if ((h0 & 0xff00) === 0xff00) return true;
  if (h0 === 0x2001 && h1 === 0x0db8) return true;
  if (h0 === 0x2002) return isPrivateIpv4(embeddedIpv4(h1, h2));
  if (h0 === 0x64 && h1 === 0xff9b) return isPrivateIpv4(embeddedIpv4(h6, h7));

  // ::ffff:0:a.b.c.d, the IPv4-translated form, is the same address again.
  if (parts.slice(0, 4).every((part) => part === 0) && parts[4] === 0xffff && h5 === 0) {
    return isPrivateIpv4(embeddedIpv4(h6, h7));
  }
  const leadingZeros = parts.slice(0, 5).every((part) => part === 0);
  if (leadingZeros && (h5 === 0xffff || h5 === 0)) {
    // :: and ::1 land here too: their embedded address starts with 0.
    return isPrivateIpv4(embeddedIpv4(h6, h7));
  }
  return false;
}

function isBlockedHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/\.+$/, '');
  if (host === '' || host === 'localhost') return true;
  if (host.startsWith('[')) return isPrivateIpv6(host.slice(1, -1));
  const ipv4 = parseIpv4(host);
  if (ipv4) return isPrivateIpv4(ipv4);
  // A single label resolves only on someone's private network.
  if (!host.includes('.')) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function hasBlockedExtension(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape cannot name an extension; the raw path is still checked.
  }
  const lastSegment = decoded.replace(/\/+$/, '').split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  return dot !== -1 && BLOCKED_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase());
}

function parse(raw: string): URL | null {
  if (raw.length > MAX_URL_LENGTH) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function isSafeResearchUrl(raw: string): boolean {
  const url = parse(raw);
  if (!url) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  return !isBlockedHost(url.hostname) && !hasBlockedExtension(url.pathname);
}

/**
 * Whether an address a hostname resolved to is off limits. Anything that cannot
 * be parsed counts as private: this guards a connection about to be opened.
 */
export function isPrivateAddress(raw: string): boolean {
  const address = (raw.split('%')[0] ?? '').toLowerCase();
  if (!address.includes(':')) {
    const octets = parseIpv4(address);
    return octets === null || isPrivateIpv4(octets);
  }
  // `dns.lookup` can print the embedded form, which the hextet parser cannot read.
  const dotted = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (dotted?.[1] !== undefined) {
    const octets = parseIpv4(dotted[1]);
    return octets === null || isPrivateIpv4(octets);
  }
  return isPrivateIpv6(address);
}

/** The URL without its fragment, tracking parameters or trailing slash; null if unparseable. */
export function normalizeResearchUrl(raw: string): string | null {
  const url = parse(raw);
  if (!url) return null;
  url.hash = '';
  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

/** http and https, and www and bare, are the same page for deduplication. */
export function urlDedupeKey(raw: string): string | null {
  const normalized = normalizeResearchUrl(raw);
  if (normalized === null) return null;
  const url = new URL(normalized);
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.host.replace(/^www\./, '')}${path}${url.search}`;
}

export function sourceIdFor(dedupeKey: string): string {
  return `src_${createHash('sha256').update(dedupeKey).digest('hex').slice(0, 10)}`;
}

/** Enough to say what was refused, without repeating a credential or a hostile path. */
export function describeRejectedUrl(raw: string): string {
  const url = parse(raw);
  if (!url) return 'a malformed URL';
  const host = url.hostname.replace(/[^a-zA-Z0-9.:[\]-]/g, '').slice(0, 80);
  return host === '' ? `a ${url.protocol} URL` : host;
}
