/**
 * Environment isolation between NexArch and the processes it runs. A
 * child spawned with `...process.env` inherits the platform's own
 * DATABASE_URL and JWT_SECRET — and because dotenv never overrides
 * variables that already exist, the generated backend would silently read
 * the PLATFORM database instead of its own .env. So children get a
 * whitelist: what a node/npm toolchain needs to function, and nothing
 * that belongs to NexArch.
 */

const PASSTHROUGH_KEYS = [
  'PATH',
  'HOME',
  'SHELL',
  'USER',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TEMP',
  'TMP',
  // Windows equivalents so nothing platform-specific creeps into callers.
  'SYSTEMROOT',
  'COMSPEC',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'USERPROFILE',
  // Proxy settings — npm install must work behind corporate proxies.
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const;

/** Minimal toolchain environment plus per-process overrides. */
export function childEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}
