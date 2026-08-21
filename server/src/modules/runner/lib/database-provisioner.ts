/**
 * Gives each run session a real database when one is available.
 *
 * `NEXARCH_RUNNER_DATABASE_URL` (optional, read here once per the
 * platform's documented provider-key convention) names a MySQL *server*
 * whose user may create databases — typically the dev container's root.
 * From it the provisioner derives one isolated database per project
 * (`nexarch_run_<slug>`), creates it via the generated project's own
 * prisma CLI, and hands back the session's DATABASE_URL.
 *
 * Deliberately never falls back to NexArch's own DATABASE_URL: the
 * platform's user is scoped to the platform's schema, and pushing a
 * generated app's tables next to the platform's would be worse than
 * running degraded. No URL configured → the caller gets null plus a
 * diagnostic, and the (fixed) generated backend boots in degraded mode.
 */

export interface ProvisionPlan {
  /** MySQL server URL without a database path, e.g. mysql://root:pw@127.0.0.1:3307 */
  serverUrl: string;
  /** Derived per-project database name. */
  databaseName: string;
  /**
   * Full DATABASE_URL for the generated app's .env. `prisma db push`
   * creates this database itself when it doesn't exist — no separate
   * CREATE DATABASE step (prisma refuses to run raw SQL against system
   * schemas, so there is no reliable pre-existing database to run one from).
   */
  databaseUrl: string;
}

/** MySQL identifier from a project slug: lowercase, underscores, bounded length. */
export function runDatabaseName(projectSlug: string): string {
  const cleaned = projectSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `nexarch_run_${cleaned || 'project'}`.slice(0, 60);
}

export function planProvisioning(projectSlug: string): ProvisionPlan | null {
  const raw = process.env.NEXARCH_RUNNER_DATABASE_URL;
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'mysql:') return null;

  const databaseName = runDatabaseName(projectSlug);
  // Rebuild from parsed parts — any database path on the configured URL is
  // ignored, credentials and host:port survive. (Query params are dropped;
  // the runner targets plain local/dev MySQL servers.)
  const auth = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
    : '';
  const serverUrl = `mysql://${auth}${parsed.host}`;
  return {
    serverUrl,
    databaseName,
    databaseUrl: `${serverUrl}/${databaseName}`,
  };
}

export const NO_DATABASE_HINT =
  'No runner database configured — the backend will start in degraded mode. ' +
  'Set NEXARCH_RUNNER_DATABASE_URL to a MySQL server URL whose user can create databases ' +
  '(e.g. mysql://root:<password>@127.0.0.1:3306) and restart NexArch to give runs a real database.';
