/**
 * Drives real round trips against the running application.
 *
 * Starting and answering a health check says a server is up. It says nothing
 * about whether login works or a saved row can be read back, which is the
 * claim "added authentication" or "added a database" makes. These requests
 * prove or disprove it against the live process, and a step that could not run
 * counts as not passed.
 *
 * Only status codes and field names reach the result. The throwaway password,
 * issued tokens and response bodies never do.
 */
import { randomBytes } from 'node:crypto';

import type {
  AuthFlowSpec,
  CrudFlowSpec,
  FlowEndpoint,
  FunctionalCheckResult,
  FunctionalCheckSpec,
  FunctionalCheckStep,
} from '../enhancement.types.js';

export type FetchLike = typeof fetch;

export interface FlowOptions {
  fetch?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface Credential {
  headers: Record<string, string>;
  kind: 'cookie' | 'bearer' | 'none';
}

interface Answer {
  status: number | null;
  body: unknown;
  cookies: string[];
  error: string | null;
}

const NO_CREDENTIAL: Credential = { headers: {}, kind: 'none' };

class FlowClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly baseUrl: string,
    private readonly options: FlowOptions,
  ) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async send(endpoint: FlowEndpoint, credential: Credential, body?: unknown): Promise<Answer> {
    // The path came from a model. Resolving it and comparing origins is what
    // keeps a plan from pointing this client at some other host.
    const base = new URL(this.baseUrl);
    const url = new URL(endpoint.path, base);
    if (url.origin !== base.origin) {
      return { status: null, body: null, cookies: [], error: 'path left the app under test' };
    }
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 15_000);
    try {
      const response = await this.fetchImpl(url, {
        method: endpoint.method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...credential.headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: this.options.signal ? AbortSignal.any([this.options.signal, timeout]) : timeout,
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text === '' ? null : (JSON.parse(text) as unknown);
      } catch {
        parsed = null;
      }
      return {
        status: response.status,
        body: parsed,
        cookies: response.headers.getSetCookie(),
        error: null,
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      return { status: null, body: null, cookies: [], error: `request failed (${name})` };
    }
  }
}

const isSuccess = (status: number | null): boolean =>
  status !== null && status >= 200 && status < 300;
const isRefused = (status: number | null): boolean => status === 401 || status === 403;

function record(
  steps: FunctionalCheckStep[],
  name: string,
  endpoint: FlowEndpoint,
  expected: string,
  answer: Answer,
  passed: boolean,
  detail: string | null = null,
): boolean {
  steps.push({
    name,
    method: endpoint.method,
    path: endpoint.path,
    expected,
    actualStatus: answer.status,
    passed,
    detail: detail ?? answer.error,
  });
  return passed;
}

function pick(source: unknown, names: readonly string[]): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  const entry = source as Record<string, unknown>;
  for (const name of names) {
    if (entry[name] !== undefined && entry[name] !== null) return entry[name];
  }
  return undefined;
}

/** The payload, whether or not the API wraps it in `{ data }`. */
function unwrap(body: unknown): unknown {
  return pick(body, ['data', 'result']) ?? body;
}

const TOKEN_FIELDS = ['accessToken', 'access_token', 'token', 'jwt', 'idToken'];

function bearerFrom(body: unknown): string | null {
  const payload = unwrap(body);
  const direct = pick(payload, TOKEN_FIELDS) ?? pick(pick(payload, ['tokens']), TOKEN_FIELDS);
  return typeof direct === 'string' && direct !== '' ? direct : null;
}

export function credentialFrom(answer: Pick<Answer, 'body' | 'cookies'>): Credential {
  const token = bearerFrom(answer.body);
  if (token !== null) return { headers: { authorization: `Bearer ${token}` }, kind: 'bearer' };
  if (answer.cookies.length > 0) {
    const cookie = answer.cookies.map((value) => value.split(';')[0]).join('; ');
    return { headers: { cookie }, kind: 'cookie' };
  }
  return NO_CREDENTIAL;
}

/** A fresh identity per run, so a rerun cannot collide with its own user. */
function testIdentity(spec: AuthFlowSpec): Record<string, unknown> {
  return {
    ...spec.extraRegisterFields,
    [spec.emailField]: `enhance-check-${randomBytes(6).toString('hex')}@example.test`,
    [spec.passwordField]: `Chk-${randomBytes(12).toString('hex')}-9a`,
  };
}

function loginBody(spec: AuthFlowSpec, identity: Record<string, unknown>): Record<string, unknown> {
  return {
    [spec.emailField]: identity[spec.emailField],
    [spec.passwordField]: identity[spec.passwordField],
  };
}

async function signIn(
  client: FlowClient,
  spec: AuthFlowSpec,
  steps: FunctionalCheckStep[],
): Promise<Credential | null> {
  const identity = testIdentity(spec);
  const registered = await client.send(spec.register, NO_CREDENTIAL, identity);
  if (
    !record(
      steps,
      'Register a new user',
      spec.register,
      '2xx',
      registered,
      isSuccess(registered.status),
    )
  ) {
    return null;
  }
  const loggedIn = await client.send(spec.login, NO_CREDENTIAL, loginBody(spec, identity));
  if (!record(steps, 'Log in', spec.login, '2xx', loggedIn, isSuccess(loggedIn.status)))
    return null;
  const credential = credentialFrom(loggedIn);
  if (credential.kind === 'none') {
    record(
      steps,
      'Receive a session',
      spec.login,
      'a token or cookie',
      loggedIn,
      false,
      'The login response carried no token or session cookie.',
    );
    return null;
  }
  return credential;
}

export async function runAuthFlow(
  baseUrl: string,
  spec: AuthFlowSpec,
  options: FlowOptions = {},
): Promise<FunctionalCheckResult> {
  const client = new FlowClient(baseUrl, options);
  const steps: FunctionalCheckStep[] = [];
  const limitations: string[] = [];
  const finish = (): FunctionalCheckResult => ({
    kind: 'auth',
    label: 'Register, log in, protected route and log out',
    passed: steps.length > 0 && steps.every((step) => step.passed),
    steps,
    limitations,
  });

  const anonymous = await client.send(spec.protected, NO_CREDENTIAL);
  record(
    steps,
    'Protected route refuses a visitor',
    spec.protected,
    '401 or 403',
    anonymous,
    isRefused(anonymous.status),
  );

  const credential = await signIn(client, spec, steps);
  if (!credential) return finish();

  const allowed = await client.send(spec.protected, credential);
  record(
    steps,
    'Protected route admits a signed-in user',
    spec.protected,
    '2xx',
    allowed,
    isSuccess(allowed.status),
  );

  const loggedOut = await client.send(spec.logout, credential);
  record(steps, 'Log out', spec.logout, '2xx', loggedOut, isSuccess(loggedOut.status));

  if (credential.kind === 'cookie') {
    const after = await client.send(spec.protected, credential);
    record(
      steps,
      'Protected route refuses after logout',
      spec.protected,
      '401 or 403',
      after,
      isRefused(after.status),
    );
  } else {
    // A bearer token the client has simply forgotten is still valid until it
    // expires. Claiming otherwise would overstate what logout did.
    limitations.push(
      'This app uses bearer tokens, so logout was checked by its response only. Whether an issued token is revoked on the server was not established.',
    );
  }
  return finish();
}

function itemEndpoint(spec: CrudFlowSpec, method: string, id: string): FlowEndpoint {
  return { method, path: `${spec.collectionPath.replace(/\/$/, '')}/${encodeURIComponent(id)}` };
}

function rowsOf(body: unknown): unknown[] {
  const payload = unwrap(body);
  if (Array.isArray(payload)) return payload as unknown[];
  const nested = pick(payload, ['items', 'rows', 'results', 'records']);
  return Array.isArray(nested) ? (nested as unknown[]) : [];
}

export async function runCrudFlow(
  baseUrl: string,
  spec: CrudFlowSpec,
  options: FlowOptions = {},
): Promise<FunctionalCheckResult> {
  const client = new FlowClient(baseUrl, options);
  const steps: FunctionalCheckStep[] = [];
  const finish = (): FunctionalCheckResult => ({
    kind: 'crud',
    label: `Create, read, update and delete a ${spec.resource}`,
    passed: steps.length > 0 && steps.every((step) => step.passed),
    steps,
    limitations: [],
  });

  let credential = NO_CREDENTIAL;
  if (spec.auth) {
    const signedIn = await signIn(client, spec.auth, steps);
    if (!signedIn) return finish();
    credential = signedIn;
  }

  const collection: FlowEndpoint = { method: 'POST', path: spec.collectionPath };
  const created = await client.send(collection, credential, spec.createBody);
  if (
    !record(
      steps,
      `Create a ${spec.resource}`,
      collection,
      '2xx',
      created,
      isSuccess(created.status),
    )
  ) {
    return finish();
  }
  const rawId = pick(unwrap(created.body), [spec.idField, 'id', '_id']);
  if (typeof rawId !== 'string' && typeof rawId !== 'number') {
    record(
      steps,
      'Read the new id',
      collection,
      `a "${spec.idField}" field`,
      created,
      false,
      'The create response carried no id.',
    );
    return finish();
  }
  const id = String(rawId);

  const listing: FlowEndpoint = { method: 'GET', path: spec.collectionPath };
  const listed = await client.send(listing, credential);
  const inList = rowsOf(listed.body).some(
    (row) => String(pick(row, [spec.idField, 'id', '_id'])) === id,
  );
  record(
    steps,
    'The new row appears in the list',
    listing,
    '2xx containing the row',
    listed,
    isSuccess(listed.status) && inList,
  );

  const getItem = itemEndpoint(spec, 'GET', id);
  const fetched = await client.send(getItem, credential);
  record(steps, 'Read the row back', getItem, '2xx', fetched, isSuccess(fetched.status));

  let update = itemEndpoint(spec, 'PATCH', id);
  let updated = await client.send(update, credential, spec.updateBody);
  if (updated.status === 404 || updated.status === 405) {
    update = itemEndpoint(spec, 'PUT', id);
    updated = await client.send(update, credential, spec.updateBody);
  }
  record(steps, 'Update the row', update, '2xx', updated, isSuccess(updated.status));

  const reread = await client.send(getItem, credential);
  const current = unwrap(reread.body) as Record<string, unknown> | null;
  const persisted =
    isSuccess(reread.status) &&
    Object.entries(spec.updateBody).every(
      ([key, value]) => JSON.stringify(current?.[key]) === JSON.stringify(value),
    );
  record(steps, 'The update was saved', getItem, 'the updated values', reread, persisted);

  const remove = itemEndpoint(spec, 'DELETE', id);
  const deleted = await client.send(remove, credential);
  record(steps, 'Delete the row', remove, '2xx', deleted, isSuccess(deleted.status));

  const gone = await client.send(getItem, credential);
  record(steps, 'The deleted row is gone', getItem, '404', gone, gone.status === 404);
  return finish();
}

export async function runFunctionalChecks(
  baseUrl: string,
  specs: readonly FunctionalCheckSpec[],
  options: FlowOptions = {},
): Promise<FunctionalCheckResult[]> {
  const results: FunctionalCheckResult[] = [];
  for (const spec of specs) {
    results.push(
      spec.kind === 'auth'
        ? await runAuthFlow(baseUrl, spec, options)
        : await runCrudFlow(baseUrl, spec, options),
    );
  }
  return results;
}
