# NexArch setup

Everything needed to run NexArch locally, and what each of the common failures
actually looks like.

## Prerequisites

| Requirement | Version                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js     | `>= 22.0.0` (`engines` in the root, server and client `package.json`; `.nvmrc` pins `22`)                                             |
| npm         | `>= 10.0.0` (root `engines`)                                                                                                          |
| PostgreSQL  | Optional, but required for persistence, project editing and integration tests. The repo's dev compose file uses `postgres:16-alpine`. |
| MySQL       | Optional. Required only to give _generated_ applications a real database. The repo's dev compose file uses `mysql:8.4`.               |

`nvm use` picks up `.nvmrc`.

## Install

```bash
npm install
```

One command for both workspaces — npm workspaces installs `server` and `client`
together, runs the server's `postinstall` (`prisma generate`) and installs the git
hooks via Husky's `prepare`.

## Configure

```bash
cp server/.env.example server/.env
```

`server/.env.example` contains placeholders only. Fill in what you need; nothing is
required to boot.

Configuration is read through a Zod schema at boot
(`server/src/shared/config/env.ts`) and exposed as a typed `config` object. A
value the schema rejects kills the process rather than letting a misconfigured
server limp into serving traffic and fail on the first request that touches the
bad value.

## PostgreSQL

NexArch's own data is PostgreSQL, through Prisma. The datasource provider is
`postgresql`, the migration lock is `postgresql`, and `DATABASE_URL` is
regex-checked at boot for a `postgresql://` or `postgres://` string. Point it
anywhere that speaks Postgres — a local server, or a managed one such as Supabase.

`DATABASE_URL` shape, with no credentials:

```
postgresql://<user>:<password>@<host>:<port>/<database>
```

For Supabase, use the direct connection on port 5432 rather than the transaction
pooler on 6543: the pooler does not support the statements migrations need, so
`prisma migrate deploy` fails against it.

Then apply the schema:

```bash
npm run db:deploy --workspace server    # apply existing migrations (deployment)
npm run db:migrate --workspace server   # create and apply a migration (development)
npm run db:push --workspace server      # sync the schema without a migration (local only)
npm run db:studio --workspace server    # browse the data
```

`DATABASE_URL` is optional. With it unset, NexArch starts in a zero-setup mode:
projects, the generation log and the Engineering Graph fall back to in-memory
backends, and they reset with the process. Two capabilities are genuinely
unavailable in that mode:

- **Generated output does not survive a restart.** `run_artifacts` is where a
  run's files live; with no database the store is a no-op that says so.
- **Editing a project is refused.** The `edit_jobs` row is what lets an edit
  outlive the request that asked for it, so the editor refuses rather than
  starting work whose outcome has nowhere to go.

## MySQL, for generated applications

NexArch's generated backends are MySQL-shaped. This is a separate database from
the platform's own, and it exists only so a previewed project has somewhere to
write.

Set `NEXARCH_RUNNER_DATABASE_URL` to a MySQL **server** URL — no database path —
whose user may `CREATE DATABASE`. Each run then gets its own
`nexarch_run_<project-slug>` database. Without it, generated backends start in
degraded mode with no database, and the run session says so rather than failing
silently.

A least-privilege user needs two grants, not one: `prisma db push` connects to the
`mysql` schema before it creates the run database, and fails with `P1010` if it
cannot. `server/.env.example` spells out both grants.

The repo's `docker-compose.dev.yml` starts both dependencies — Postgres on host
port 5432 and MySQL published on host port **3307** (mapped to the container's 3306) — with credentials that match `server/.env.example` for zero-config startup:

```bash
npm run docker:dev
```

That needs Docker installed. Without Docker, install PostgreSQL and MySQL locally
and point the two URLs at them; nothing in NexArch requires containers.

## Development commands

Run these from the repo root unless a workspace is named. Root-level `lint`,
`typecheck` and `test` fan out across both workspaces.

| Command                             | What it does                                                        |
| ----------------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                       | Server and client concurrently — API on `:4000`, console on `:5173` |
| `npm run dev:server`                | Server only (`tsx watch`)                                           |
| `npm run dev:client`                | Console only (Vite)                                                 |
| `npm run build`                     | Production build of both workspaces                                 |
| `npm run lint` / `npm run lint:fix` | Typed ESLint across both workspaces                                 |
| `npm run typecheck`                 | Strict TypeScript across both workspaces                            |
| `npm run format` / `format:check`   | Prettier over the repo                                              |
| `npm run db:generate`               | Regenerate the Prisma client                                        |
| `npm run docker:up` / `docker:down` | The production-shaped compose stack (needs Docker)                  |

The console's Vite dev server proxies `/api` to `http://localhost:4000`, so the
browser stays on one origin in development.

## Test commands

The three `package.json` files do not all define the same scripts, so the exact
commands matter.

**Root** (`package.json`) — fans out to both workspaces:

```bash
npm test                  # npm run test --workspaces
npm run test:e2e          # playwright test
npm run test:e2e:install  # playwright install chromium (once)
```

**Server** (`server/package.json`) — Node's built-in test runner through `tsx`:

```bash
npm test --workspace server              # NODE_ENV=test node --import tsx --test $npm_package_config_testFiles
npm run test:coverage --workspace server # the same list, with --experimental-test-coverage
npm run test:integration --workspace server
```

The unit suite runs an **explicit list of 35 files** held in the `config.testFiles`
key of `server/package.json`, not a glob. npm exports `config` keys as
`$npm_package_config_*` to every script it runs, so `test` and `test:coverage`
read one list and cannot drift apart. The list is explicit rather than a glob
because `*.integration.test.ts` needs a live database and runs separately. Adding
a unit test file means adding it to that key.

`test:integration` runs a hand-named list of four files and **requires a live
database** — it talks to whatever `DATABASE_URL` points at:

```
src/modules/project-editor/edit-jobs.integration.test.ts
src/modules/pipeline/run-artifacts.integration.test.ts
src/modules/workspace/workspace.integration.test.ts
src/modules/engineering-graph/engineering-graph.integration.test.ts
```

**Client** (`client/package.json`) — Vitest:

```bash
npm test --workspace client              # vitest run
npm run test:watch --workspace client    # vitest
npm run test:coverage --workspace client # vitest run --coverage --testTimeout=30000
```

The coverage script raises the timeout deliberately: v8 instrumentation adds
enough per-call overhead that the `userEvent` tests blow past the 5s default and
fail as timeouts, which would make the coverage number unobtainable.

Under `NODE_ENV=test` the model router pins to the deterministic `mock` provider
whatever the environment says, so a real key in `.env` cannot turn the test suite
into billed, flaky, network-dependent calls.

**End-to-end** (`e2e/`, Playwright) drives the real stack — nothing is mocked, and
the preview flow runs a real `npm install` inside a generated project. There is no
`webServer` block in `playwright.config.ts`, so the stack must already be running;
if nothing answers at `E2E_BASE_URL` (default `http://localhost:5173`) every spec
skips with the command that would make it runnable. See `e2e/README.md`.

## Preview requirements

Running a generated project locally needs:

- A `backend/package.json` or `frontend/package.json` with a `dev` script in the
  generated output. The run's logs name the cause when there is none.
- Free ports. The backend prefers 4000 and the frontend 5173; the scanner takes
  the first free port from there, which in practice means `4001+` and `5174+`
  while NexArch itself holds the defaults.
- Disk and time for `npm install` inside each run workspace. Workspaces default to
  the OS temp directory (`NEXARCH_RUNNER_DIR` overrides it) and are pruned at boot.
- `NEXARCH_RUNNER_DATABASE_URL`, if the generated app should have a real database.

Previews run generated code with your privileges. Read
[SECURITY.md](SECURITY.md) before running one.

## Environment variables

By name and purpose only. Never commit a value; `server/.env` is git-ignored and
`server/.env.example` holds placeholders.

### Validated at boot

These are declared in `server/src/shared/config/env.ts`, and an invalid value
stops the process.

| Variable                         | Purpose                                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                       | Runtime mode: `development`, `test` or `production`.                                                                                                                                                  |
| `PORT`                           | Port the API listens on.                                                                                                                                                                              |
| `LOG_LEVEL`                      | Winston level: `error`, `warn`, `info`, `http` or `debug`.                                                                                                                                            |
| `DATABASE_URL`                   | PostgreSQL connection string. Unset switches on the in-memory mode.                                                                                                                                   |
| `AUTH_DISABLED`                  | `true` (default) runs every request as one built-in local user, for requests from this machine only; the server refuses to start with it under `NODE_ENV=production`. `false` turns on real accounts. |
| `GENERATED_APP_AUTH`             | Whether sign-in is planned into the applications NexArch generates.                                                                                                                                   |
| `CORS_ORIGINS`                   | Comma-separated allow-list of browser origins.                                                                                                                                                        |
| `RATE_LIMIT_WINDOW_MS`           | Rate-limit window, per IP. Default 60000.                                                                                                                                                             |
| `RATE_LIMIT_MAX`                 | Requests allowed per window. Default 100.                                                                                                                                                             |
| `EDIT_JOB_RETENTION_DAYS`        | How long a finished edit job is kept before the boot sweep deletes it. Default 30.                                                                                                                    |
| `EXECUTION_EVENT_RETENTION_DAYS` | How long an ended job's timeline and usage rows are kept before the boot sweep deletes them. Default 90.                                                                                              |
| `JWT_SECRET`                     | Signs access and refresh tokens. Minimum 32 characters, and required when `AUTH_DISABLED=false`.                                                                                                      |
| `JWT_EXPIRES_IN`                 | Access-token lifetime.                                                                                                                                                                                |
| `JWT_REFRESH_EXPIRES_IN`         | Refresh-token lifetime.                                                                                                                                                                               |

### Read where they are used

These are read at their point of use rather than through the schema above, so an
invalid value degrades the feature instead of stopping the boot. (`env.ts`'s own
header claims every variable the process reads is declared there; these are the
exceptions.)

| Variable                          | Purpose                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`                     | Primary model provider: `groq`, `claude`, `openai`, `gemini`, `openrouter`, `cerebras` or `mock`.                                     |
| `AI_PROVIDER_DEEP`                | Where planning and design start, when that should differ from `AI_PROVIDER`.                                                          |
| `AI_PROVIDER_RESEARCH`            | Which provider reasons over web evidence. Defaults to OpenRouter when it has a key, then to the deep route.                           |
| `AI_PROVIDER_CHAIN`               | Comma-separated failover order after the first provider. Replaces `AI_FALLBACK_PROVIDER` when set.                                    |
| `AI_JOB_TOKEN_CEILING`            | Model tokens one job may use before it is stopped. Default 1500000.                                                                   |
| `AI_JOB_CALL_CEILING`             | Provider calls one job may make before it is stopped, failed calls included. Default 150.                                             |
| `CEREBRAS_API_KEY`                | Cerebras key.                                                                                                                         |
| `AI_MODEL_<PROVIDER>_<TIER>`      | One provider's model for a tier (`FAST`, `DEEP`, `VISION`), for example `AI_MODEL_GEMINI_DEEP`. Wins over the generic tier variables. |
| `WEB_RESEARCH_ENABLED`            | `false` turns web research off entirely.                                                                                              |
| `WEB_RESEARCH_RENDER_REFERENCES`  | `false` never loads third-party pages in headless Chromium on this server.                                                            |
| `BRAVE_SEARCH_API_KEY`            | Brave Search key for web research. Metered.                                                                                           |
| `TAVILY_API_KEY`                  | Tavily key for web research. With neither search key, research reports itself unavailable and generation proceeds.                    |
| `AI_FALLBACK_PROVIDER`            | Provider tried when the primary is unconfigured or exhausts its retries.                                                              |
| `AI_API_KEY`                      | The model key for the selected provider. Server-side only.                                                                            |
| `GROQ_API_KEY`                    | Groq key; wins over `AI_API_KEY` when both are set.                                                                                   |
| `ANTHROPIC_API_KEY`               | Claude key. `AI_API_KEY` is not read for this provider.                                                                               |
| `OPENAI_API_KEY`                  | OpenAI key. `AI_API_KEY` is not read for this provider.                                                                               |
| `GEMINI_API_KEY`                  | Gemini key. `AI_API_KEY` is not read for this provider.                                                                               |
| `OPENROUTER_API_KEY`              | OpenRouter key. `AI_API_KEY` is not read for this provider.                                                                           |
| `AI_MODEL_FAST`                   | Model id for simple extraction and small, scoped regeneration.                                                                        |
| `AI_MODEL_DEEP`                   | Model id for whole-project planning and complex refactors.                                                                            |
| `AI_MODEL_VISION`                 | Model id for reading reference images. A text model cannot stand in.                                                                  |
| `AI_MAX_REQUEST_TOKENS`           | Ceiling on one request's context plus output tokens. Default 32000.                                                                   |
| `NEXARCH_RUNNER_DIR`              | Workspace root for local runs. Defaults to the OS temp directory.                                                                     |
| `NEXARCH_RUNNER_DATABASE_URL`     | MySQL _server_ URL that gives each generated-app run its own database.                                                                |
| `NEXARCH_RUNNER_MAX_SESSIONS`     | In-flight runs allowed per owner. Default 2.                                                                                          |
| `NEXARCH_RUNNER_MAX_ACTIVE_TOTAL` | In-flight runs allowed machine-wide, across every owner. Defaults to four times the per-owner cap.                                    |
| `NEXARCH_RUNNER_MAX_INSTALLS`     | Concurrent `npm install`s. Default 1 — keeps small machines out of swap and lets the second install hit a warm cache.                 |
| `VERCEL_TOKEN`                    | Enables the Vercel deploy provider's execution step.                                                                                  |
| `RAILWAY_TOKEN`                   | Enables the Railway deploy provider's execution step.                                                                                 |
| `RAILWAY_SERVICE_ID`              | Railway service the deploy provider targets.                                                                                          |
| `RAILWAY_ENVIRONMENT_ID`          | Railway environment the deploy provider targets.                                                                                      |
| `RENDER_API_KEY`                  | Enables the Render deploy provider's execution step.                                                                                  |
| `RENDER_SERVICE_ID`               | Render service the deploy provider targets.                                                                                           |

### Elsewhere in the repo

| Variable                                                                       | Purpose                                                                                                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_BASE_URL`                                                                 | Base URL the Playwright suite drives. Default `http://localhost:5173`.                                                                                |
| `POSTGRES_DB` · `POSTGRES_USER` · `POSTGRES_PASSWORD`                          | Consumed by `docker-compose.yml` for the bundled Postgres container.                                                                                  |
| `SERVER_PORT` · `CLIENT_PORT` · `POSTGRES_PORT`                                | Published host ports for the compose stack.                                                                                                           |
| `BIND_ADDRESS`                                                                 | Host address the compose stack publishes on. Default `127.0.0.1`. Widening it exposes a platform whose generated apps run with no OS-level isolation. |
| `BACKEND_URL` · `API_BASE_URL` · `BASE_URL` · `GIT_COMMIT` · `BUILD_TIMESTAMP` | Read by _generated_ project code and emitted templates, not by the NexArch process.                                                                   |

## Common setup failures

**The API boots but logs `database unreachable — continuing in degraded mode`.**
In development the API deliberately stays up so the console and the health
endpoints keep working while the database is starting; `GET /api/v1/health`
reports it. In production the same condition exits the process instead.

The database that failed to connect is **PostgreSQL** — `DATABASE_URL` is checked
for a `postgresql://` string, and the Prisma datasource and migration lock are both
`postgresql`. Check your Postgres, not your MySQL; MySQL is only ever the database
handed to generated apps. The log line's hint says so (`start PostgreSQL and check
DATABASE_URL, then restart`), but two module headers —
`pipeline/lib/run-store.ts` and `workspace/lib/project-store.ts` — still describe
the platform's own store as MySQL. Those are stale comments, not behaviour.

**`Fatal: invalid environment configuration`.** The Zod schema rejected a value and
the process exited before opening a socket; the output names the variable and the
reason. The most common one is `DATABASE_URL` that is not a `postgresql://` or
`postgres://` string.

**`Fatal: AUTH_DISABLED is false but JWT_SECRET is missing or too short`.** Turning
accounts on requires a real secret of at least 32 characters. The no-auth
placeholder is never used to sign real tokens.

**`Fatal: AUTH_DISABLED=true is refused when NODE_ENV=production`.** No-auth mode
makes every request an unauthenticated admin, so production will not start with it.
Set `AUTH_DISABLED=false` and a `JWT_SECRET`. The compose stack always runs with
accounts on, and `docker compose` itself stops if `JWT_SECRET` is not set in `.env`.

**Requests get `403` saying login is turned off.** In no-auth mode the API answers
only requests from its own machine. Use it locally, or turn accounts on.

**A job fails naming `AI_JOB_TOKEN_CEILING` or `AI_JOB_CALL_CEILING`.** The job hit
its spend limit and was stopped. Look at the job's usage for what repeated before
raising the limit.

**AI stages report `degraded`.** No usable provider key, so the stage fell back to
its deterministic generator. That is a downgrade, not an outage: the pipeline runs
end to end either way, and the run records which stages degraded. Set a key for
the model path.

**`prisma migrate deploy` fails against Supabase.** Use the direct connection on
port 5432; the transaction pooler on 6543 does not support the statements
migrations need.

**A generated app starts with no database.** `NEXARCH_RUNNER_DATABASE_URL` is unset
or its user cannot create databases. `P1010` specifically means the user lacks
access to the `mysql` schema, which `prisma db push` connects to before creating
the run database.

**A local run will not start.** The generated output needs a `backend/package.json`
or `frontend/package.json` with a `dev` script. The session's logs name the cause,
and the diagnostics translate common failures into sentences rather than exit
codes.

**"You already have N runs going."** The per-owner in-flight cap
(`NEXARCH_RUNNER_MAX_SESSIONS`, default 2). The refusal names which projects hold
the slots. "This NexArch instance is at its run capacity" is the separate
machine-wide cap (`NEXARCH_RUNNER_MAX_ACTIVE_TOTAL`), which the caller has nothing
to stop.

**"Edits cannot be started without a database."** Exactly what it says: the edit-job
row is what lets an edit outlive its request. Set `DATABASE_URL`.

**An edit reports `INTERRUPTED`.** The server restarted while it was running. The
edit was not applied and the project still has the files it had, because an edit
writes nothing until its checks pass — but check the project before editing again.

**Port already in use.** The API is `4000` and the console `5173`; change `PORT`, or
free the port. Previews scan for free ports and will not take either.
