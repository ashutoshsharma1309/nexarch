# NexArch — Project Summary for AI Assistants

> Read this first. It exists so that any LLM (or human) can understand what this
> project is, how it is built, what its invariants are, and how to work on it
> without breaking its conventions. The README covers usage; this file covers
> understanding.
>
> **Accuracy contract:** every claim below was cross-checked against the code at
> commit `6c4e3be` (Phase 14). If you change behaviour, update the matching line
> here in the same commit — a stale summary is worse than none, because the next
> assistant will trust it.

## 0. Orientation — read this before you touch anything

If you are an AI assistant picking this project up cold, these five facts
determine whether your first change fits or fights the codebase:

1. **There is one product surface now, not eighteen.** A user signs in, types a
   prompt on `/forge`, and `POST /api/v1/pipeline/runs` drives every generator
   stage server-side. The individual module endpoints still exist and still
   work, but they are the machinery, not the product.
2. **Two stages call a real model; the other five are deterministic.** This is
   deliberate and load-bearing — see §4.10. Do not "improve" the platform by
   routing more stages through an LLM without reading that invariant first.
3. **Auth is real and the pipeline is behind it.** `requireAuth` guards
   `/api/v1/pipeline/*`. Anything you add that writes to a user's workspace
   belongs behind it too.
4. **GitHub integration was deleted in Phase 14.** If you find a reference to a
   `github` module, `GITHUB_TOKEN`, or `/api/v1/github`, it is stale — report it
   rather than rebuilding against it.
5. **Nothing persists across a restart except users and projects.** Pipeline
   runs, runner sessions and deploy executions are in-process maps. That is a
   known, accepted tradeoff for a local single-user console (§9).

**Status:** v1.2 — the 12 build phases, plus Phase 13 (end-to-end lifecycle) and
Phase 14 (one product: real AI, one pipeline, real auth). All verified and
pushed. A forward-looking multi-agent design for v2.0 lives at
`docs/v2/NEXARCH_V2_ARCHITECTURE.md` but is **design only — nothing in it is
implemented**.

## 1. What this project is

NexArch is an **AI-powered end-to-end software engineering platform**. A user
describes an application in plain language; NexArch analyzes the requirements,
plans the architecture, designs the database, generates hardened backend and
frontend code, wires in security, and tracks dependencies for incremental
regeneration. It then closes the loop after generation: run the generated
project locally with one click (install, port allocation, log streaming), preview
it in the console, deploy it through provider abstractions (Vercel/Railway/
Render), regenerate incrementally from a prompt diff, and auto-produce an
architecture analysis with diagrams and scores.

Two things matter to keep straight:

- **NexArch itself** is a TypeScript platform (Express API + React console) that
  is _mostly_ deterministic. Its planners and generators are rule/template
  engines that run with no LLM at all. Exactly two stages call a model — the
  requirement analyzer and the entity-field designer — and both degrade to
  deterministic output when no key is configured. The remaining optional
  integrations are gated on credentials read at call time: `deployment`'s
  execute layer (provider APIs) and the `runner`'s database provisioner.
  Without any of those tokens everything else still works.
- **Generated projects** are the _output_: complete Express/Prisma backends and
  React/Vite frontends with tests, docs, Docker, and CI — produced _by_ the
  platform for the user's described app. Don't confuse the platform's own
  infrastructure with the infrastructure it generates for downstream projects
  (e.g. `server/src/modules/deployment` generates deployment files _for
  generated apps_; the repo-root `docker-compose.yml` deploys _NexArch itself_).

## 2. Stack

| Layer   | Technology                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server  | Node.js ≥ 22 · Express 5 · TypeScript (strict) · Prisma + MySQL 8.4 · Zod (env) · express-validator · Helmet · bcrypt · jsonwebtoken · cookie-parser · Winston · node:test |
| Client  | React 19 · Vite · TypeScript · TailwindCSS 4 · React Router · TanStack Query · Zustand · React Hook Form · Zod · Axios · Framer Motion                                     |
| Tooling | npm workspaces (`server/`, `client/`) · typed flat-config ESLint · Prettier · Husky + lint-staged · GitHub Actions CI · Docker + Compose                                   |

Scale (measured at `6c4e3be`): ~290 server TS files (~36.1k LOC), ~139 client
TS/TSX files (~15.3k LOC), 272 server tests across 14 `node:test` suites + 24
client tests across 6 Vitest suites — **296 total, all green**.

## 3. Repository layout

```
package.json              # npm workspaces root; all everyday commands live here
docker-compose.yml        # NexArch's own production-shaped stack (MySQL + API + nginx console)
docker-compose.dev.yml    # dev MySQL only
.github/workflows/ci.yml  # verify job (lint/typecheck/test/build) + docker job (builds both images)
.env.example              # Compose-level vars (MYSQL_*, JWT_SECRET, ports)
docs/v2/                  # NexArch 2.0 multi-agent DESIGN document (not implemented)
reports/                  # generated audit artifacts from the final integration pass
FINAL_PROJECT_SUMMARY.md  # narrative wrap-up of the original 12-phase build (PRE-Phase-13; historical only)

server/
  .env.example            # the API's own runtime env contract (DATABASE_URL, JWT_*, AI_*, CORS_ORIGINS…)
  prisma/schema.prisma    # Role, User, Project, Generation (platform bookkeeping)
  src/
    index.ts              # process lifecycle: boot, listen, graceful shutdown
    app.ts                # middleware pipeline + module mounting; no socket, no DB
    modules/              # 17 module folders → 18 mounted AppModules — see catalog below
      index.ts            # THE module registry; a module exists iff it is listed here
    shared/               # the ONLY code modules may share
      config/env.ts       # the Zod-validated env schema, read once at boot
      config/index.ts     # the typed `config` object every module imports (never process.env)
      database/prisma.ts  # prisma client + connect/disconnect
      logger/             # Winston logger
      middleware/         # error-handler, rate-limiter, request-context, request-logger, security, validate
      types/              # api envelope, module contract, requirement/architecture/design types, express.d.ts
      utils/              # api-response, app-error, module-scaffold, strings

client/
  src/
    app/                  # router (auth-gated route tree) + 404
    features/             # 24 folders: auth, dashboard, prompt (the Forge), pipeline, preview,
                          #   architecture, database, backend, frontend, security, dependency-graph,
                          #   ai-orchestrator, insights, runner, deployment, projects, generation,
                          #   quality, documentation, exports, logs, notifications, search, settings
    shared/
      services/           # one <module>.service.ts per server module + api-client.ts (the only axios use)
      components/ layouts/ hooks/ lib/ store/ styles/ types/
  nginx.conf              # prod serving: SPA fallback + /api proxy to the server container
```

Note: `features/pipeline/` and `features/preview/` are not nav entries. The
pipeline components are used by the Forge page, and Preview is reached at
`/preview/:runId` from a finished run.

## 4. Architectural invariants (do not break these)

1. **Modules are islands — across _internals_.** A server module owns its URL
   subtree and its internals. A module may import another module's **public
   `index.ts` export** or its top-level `<name>.service.ts`; it may never reach
   into another module's `lib/`, controller, validator, or router. Two places
   exercise this deliberately: `auth/index.ts` re-exports `requireAuth` /
   `requireRole` as its public surface, and `pipeline` composes the generator
   services by importing them (`architecture.service`, `database-designer.service`,
   …) rather than re-implementing them. Everything genuinely shared still lives
   only in `server/src/shared/`.
2. **One module contract.** Every module exports an `AppModule`
   (`{ name, basePath, description, router }`, see `shared/types/module.ts`) and
   is mounted by adding exactly one line to `server/src/modules/index.ts`.
3. **Consistent module file layout.** `index.ts` (the AppModule),
   `<name>.router.ts`, `<name>.controller.ts`, `<name>.service.ts`,
   `<name>.validator.ts`, `<name>.types.ts`, `<name>.service.test.ts`, and
   `lib/` for the real machinery. Layering: types → lib → service → validator →
   controller → router. `auth` adds `auth.middleware.ts` for its guards.
4. **One error pathway.** Throw `AppError` (or let the handler normalize);
   a single error handler emits the stable JSON envelope. Every response carries
   `X-Request-Id` (also in `meta.requestId`), joinable against server logs.
5. **One response envelope.** Every JSON response is `ApiSuccess<T>` or
   `ApiFailure` (`shared/types/api.ts`); clients branch on `success`. The
   client mirrors these types in `client/src/shared/types/api.ts` (a single
   ~1720-line type-mirror file — an accepted convention, don't split casually).
6. **Config is validated at boot.** `process.env` is parsed in exactly one file
   (`shared/config/env.ts`) through Zod, and modules import the typed `config`
   object from `shared/config/index.ts` — never `process.env`. A misconfigured
   server refuses to start. Documented exception: optional integration
   credentials and knobs are read at call time in their provider/lib files so
   the platform boots and runs without them —
   - `AI_PROVIDER` / `AI_FALLBACK_PROVIDER` / `AI_MODEL_FAST` / `AI_MODEL_DEEP`
     and the keys `AI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`,
     `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` (ai-orchestrator);
   - `VERCEL_TOKEN` / `RAILWAY_TOKEN`+ids / `RENDER_API_KEY`+`RENDER_SERVICE_ID`
     (deployment execute layer);
   - `NEXARCH_RUNNER_DIR` / `NEXARCH_RUNNER_MAX_SESSIONS` /
     `NEXARCH_RUNNER_DATABASE_URL` (runner — the last one names a MySQL server
     whose user can `CREATE DATABASE`; each run session then gets its own
     isolated `nexarch_run_<project>` schema, and without it generated backends
     boot in degraded mode).
7. **The client never sees axios or envelopes.** Features consume typed hooks →
   services → `api-client.ts`, which unwraps envelopes, normalizes failures, and
   owns the single refresh-and-replay interceptor. Nothing else imports axios.
8. **Tests run against real artifacts.** Server `*.service.test.ts` suites
   drive the actual upstream pipeline (real analyzer → planner → generator
   output) rather than hand-shaped fixtures. Follow that pattern.
9. **app.ts owns wiring, index.ts owns lifecycle.** `createApp()` touches no
   socket and no DB (supertest-able); process boot/shutdown lives in
   `index.ts`. In development the API boots in degraded mode without MySQL;
   in production it refuses to start. Middleware order is deliberate:
   context → security → compression → **cookies** → body parsing → logging →
   rate limit → modules → 404 → errors.
10. **The AI/deterministic split is a design rule, not an accident.** The model
    supplies _semantics_ (what this domain is, what its entities are, what
    business columns they carry); deterministic code supplies _structure_ (the
    plan, the schema, the files, the hardening). Anything code can derive
    correctly is derived by code. That is what keeps a run to **two bounded
    calls (~3k tokens, ~$0.001)** instead of eight open-ended ones, and it is
    why generated output is reproducible. Both AI stages degrade rather than
    fail: with no key, or a provider that is down, the run continues on the
    rule-based analyzer and field-hint tables and marks the stage `degraded`.
11. **`npm test` must never make a network call.** `defaultRoutes()` in
    `ai-orchestrator/lib/model-router.ts` pins every route to the `mock`
    provider when `NODE_ENV === 'test'`, and the server `test` script sets it.
    A developer with a real key in `.env` would otherwise turn the suite into
    billed, flaky, offline-hostile calls. Don't remove that guard.

## 5. Module catalog (server, all under `/api/v1`)

18 `AppModule`s from 17 folders (`database-designer` exports two). Pipeline
order — each stage consumes the previous stage's structured output:

| #   | Module                | Base path       | What it does                                                                                                        |
| --- | --------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | `health`              | `/health`       | `GET /`, `/live`, `/ready` — diagnostics; 503 + degraded report when MySQL is down                                  |
| 2   | `auth`                | `/auth`         | `POST /register`, `/login`, `/refresh`, `/logout`; `GET /me` — local accounts, bcrypt, JWT in httpOnly cookies.     |
|     |                       |                 | Exports `requireAuth` / `requireRole`. Credential endpoints carry their own tighter rate limit (20 / 15 min).       |
| 3   | `pipeline`            | `/pipeline`     | **The product endpoint.** `POST /runs` (202), `GET /runs`, `GET /runs/:id`, `GET /runs/:id/artifacts`,              |
|     |                       |                 | `POST /runs/:id/retry` — composes stages 4–10 into one run. Whole subtree behind `requireAuth`.                     |
| 4   | `analysis`            | `/analyze`      | `POST /` — natural-language prompt → structured requirement spec (entities, features, roles, constraints)           |
| 5   | `architecture`        | `/architecture` | `POST /` — requirement spec → Software Design Spec (SDS): tech choices, module plan, folder plan, API plan, scaling |
| 6   | `database-designer`   | `/database`     | `POST /design` — SDS → schemas (Prisma/SQL), ER model, validation rules                                             |
|     | (same module)         | `/openapi`      | `POST /generate` — OpenAPI 3.1 contract from SDS + design                                                           |
| 7   | `backend-generator`   | `/backend`      | `POST /generate` — SDS + design → complete Express/Prisma backend project (files as structured output)              |
| 8   | `frontend-generator`  | `/frontend`     | `POST /generate` — SDS + design → complete React/Vite frontend project                                              |
| 9   | `security-engine`     | `/security`     | `POST /analyze`, `POST /apply`, `GET /report` — JWT/RBAC hardening + security analysis of generated output          |
| 10  | `dependency-graph`    | `/dependency`   | `POST /build`, `/analyze`, `/diff` (old spec vs new spec → selective regeneration plan), `/regenerate`,             |
|     |                       |                 | `GET /graph`, `/statistics` — change-impact analysis, prompt-diff incremental regeneration                          |
| 11  | `ai-orchestrator`     | `/ai`           | `POST /generate`, `/retry`, `/workflow`, `GET /history`, `/statistics` — provider registry (groq, claude, openai,   |
|     |                       |                 | gemini, openrouter, mock) + data-driven model router; resolves to `mock` when nothing is configured                 |
| 12  | `workspace`           | `/`             | Projects CRUD (`/projects`, `/project/:id`, duplicate, generations), `/history`, `/statistics`, `/export` (zip),    |
|     |                       |                 | `/documentation` — persistence layer over Prisma                                                                    |
| 13  | `deployment`          | `/deployment`   | `POST /generate`, `/export`, `GET /status`, `/health` — deployment infra for GENERATED apps across 12 targets.      |
|     |                       |                 | Execute layer: `GET /providers`, `POST /execute/plan`, `POST /execute`, `GET /executions(/:id)` —                   |
|     |                       |                 | provider abstraction (Vercel/Railway/Render), state machine queued→building→deploying→live/failed, token-gated      |
| 14  | `quality`             | `/`             | `/quality/analyze`, `/quality/export`, `/quality/report`, `/testing/run`, `/documentation/generate`,                |
|     |                       |                 | `/performance/report`, `/release/readiness` — scoring (9 categories, A–F), test generation, docs, benchmarks        |
| 15  | `insights`            | `/insights`     | `POST /generate` — automatic architecture analysis: summary, "why this tech?" justifications quoting planner        |
|     |                       |                 | decisions, folder/db/api/security explanations, Mermaid architecture/ER/API-flow diagrams, explained scores         |
| 16  | `runner`              | `/runner`       | `POST /plan`, `/sessions`, `/sessions/:id/stop`, `/restart`; `GET /sessions(/:id)`, `/sessions/:id/logs` —          |
|     |                       |                 | one-click local run: workspace write, install, free-port allocation, log streaming (cursor), failure diagnostics.   |
|     |                       |                 | Child processes are swept on signalled shutdown, not just clean exit.                                               |
| —   | `review` _(scaffold)_ | `/review`       | Manifest only. Planned: static analysis + optimization pass gating REVIEWING → COMPLETED.                           |

`review` is the **only** remaining scaffold. The `github` module was removed in
Phase 14 — generated CI/CD workflow artifacts (which describe the _user's_
future deployment) stay.

Each module keeps its real machinery in `lib/` (e.g. `architecture/lib/` has
technology-engine, module/database/api/folder/frontend/security/scalability
planners; `quality/lib/` has analyzers, scorers, and unit/api/e2e/frontend test
generators; `pipeline/lib/` has `ai-stages.ts` — the only two model calls in the
platform — and `spec-normalizer.ts`).

## 6. Data model (platform's own, Prisma + MySQL)

Four models — the platform's bookkeeping, not generated-app data:

- **Role** → **User**. Roles are rows, not an enum, and `auth.service.ts`
  lazily creates `ADMIN`/`USER` on first use so a fresh install needs no seed
  step before the first signup. **The first account created becomes `ADMIN`;
  everyone after is `USER`.**
- **User** — bcrypt `passwordHash`. Still nullable in the schema so
  seed/staging users can exist without fake credentials; a null hash simply
  cannot log in (it fails the same way a wrong password does).
- **User** → **Project** (slug, status DRAFT/ACTIVE/ARCHIVED)
- **Project** → **Generation** — one persisted pipeline record each; status
  mirrors the pipeline (PENDING → ANALYZING → PLANNING → GENERATING →
  REVIEWING → COMPLETED/FAILED).

Sessions are stateless: there is no session/refresh-token table. A refresh
token is a JWT with a `type: 'refresh'` claim, verified against the expected
type so it can never be replayed as an access token. Logout clears cookies; it
does not revoke server-side (see §9).

## 7. How to run it

```bash
# Dev (recommended while working)
npm install
cp server/.env.example server/.env   # defaults work with the dev database
npm run docker:dev                   # MySQL 8.4 in Docker
npm run db:push
npm run dev                          # API :4000, console :5173 (Vite proxies /api)
# then open http://localhost:5173 → you'll land on /register. The first
# account you create is the install's ADMIN.

# Production shape (all in Docker: MySQL + API + nginx console)
cp .env.example .env                 # set MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD, JWT_SECRET
docker compose up --build            # console :8080, API :4000
```

Verification suite (run all before committing; CI runs the same):

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
```

Notes:

- **A database is now required to use the console at all** — signing in needs
  the `users` table. The API still boots degraded without MySQL in development,
  but you cannot get past `/login`.
- Dockerfiles use the REPO ROOT as build context (`docker build -f server/Dockerfile .`)
  and pass `--ignore-scripts` to `npm ci` (the root `prepare` script runs husky,
  which isn't installed by `npm ci --workspace <name>` — this was a real bug, fixed).
- If host port 3306 is occupied by a local MySQL, set `MYSQL_PORT=3307` in `.env`.
- **AI is optional.** Set `AI_PROVIDER=groq` and `AI_API_KEY=<key>` for real
  model calls in the analysis and architecture stages. With no key both stages
  fall back to the rule-based analyzer and report `degraded` — a downgrade, not
  an outage. `AI_MODEL_FAST` / `AI_MODEL_DEEP` override the models;
  `AI_FALLBACK_PROVIDER` (default `claude`) is tried when the primary has no
  key. Provider-specific keys (`GROQ_API_KEY`, `ANTHROPIC_API_KEY`, …) win over
  `AI_API_KEY`.
- Other optional integration tokens (same provider-key convention):
  `VERCEL_TOKEN` / `RAILWAY_TOKEN`+ids / `RENDER_API_KEY`+`RENDER_SERVICE_ID`
  (one-click deploy), `NEXARCH_RUNNER_DIR` / `NEXARCH_RUNNER_MAX_SESSIONS` /
  `NEXARCH_RUNNER_DATABASE_URL` (runner knobs — the DB URL gives each run its
  own provisioned MySQL schema; without it runs boot in degraded mode).
  Everything is built and gated — only final execution needs the tokens.

## 8. Conventions an assistant must follow

- **Adding a server capability** = new folder in `server/src/modules/<name>/`
  following the file layout in §4.3 + one registry line in `modules/index.ts` +
  a client service/feature if it has UI. Nothing else changes.
- **Anything that writes to a user's workspace goes behind `requireAuth`**,
  the way `pipeline` does (`router.use(requireAuth)` at the top of the router).
- **Comments explain why, not what.** The codebase carries deliberate header
  comments documenting decisions; match that density and tone.
- **Commit style:** detailed "why not just what" messages; subject in
  imperative mood. Never commit `.env` (gitignored; `.env.example` files are
  the contract). `.vscode/settings.json` **is** intentionally tracked — the
  `.gitignore` un-ignores it on purpose so editor config is shared; don't
  "clean it up".
- **Verification before commit** is non-negotiable: lint, typecheck, tests,
  build, format:check must all pass (Husky + lint-staged also enforce on
  commit).
- **Prettier owns formatting** — run `npm run format` rather than hand-aligning.

## 9. Known gaps and accepted tradeoffs (as of v1.2)

- `review` is the last intentional scaffold (§5).
- **Nothing about a run survives a restart.** Pipeline runs (capped at the last
  20, in a process-local `Map`), runner sessions and deploy executions live in
  memory, not the database — a server restart forgets them and kills the child
  processes. This fits a local single-user console but would need persistence
  for multi-user hosting.
- **Sessions cannot be revoked server-side.** Logout clears the cookies, but a
  stolen refresh JWT stays valid until it expires (7 days). A token
  denylist/session table is the fix if this ever ships multi-user.
- `client/src/shared/types/api.ts` is a single ~1720-line type-mirror file —
  known, accepted convention; don't split it without cause.
- CI builds Docker images but doesn't push/deploy them — publishing is
  deliberately deferred to whichever hosting target is chosen.
- Vercel can host the client only; the API needs a persistent-process host
  (Railway/Render/Fly) plus managed MySQL.
- Deploy-execute flows are fully built but remain disabled until their tokens
  are configured (§4.6) — plan/status endpoints work untokened; only final
  execution is gated.
- The AI cost/token figures (~3k tokens, ~$0.001 per run) are the Groq
  defaults; a different `AI_PROVIDER` changes them substantially.

## 9b. What Phase 14 changed (the most recent work)

The platform became one product instead of a set of independently callable
stages:

- **Real AI in the pipeline.** A Groq adapter joins the provider registry, and
  the routing table is now configuration (`AI_PROVIDER`, `AI_MODEL_FAST`,
  `AI_MODEL_DEEP`, `AI_FALLBACK_PROVIDER`). Two stages call a model: the
  Requirement Analyzer produces the `RequirementSpec`, and the Architecture
  stage designs each entity's business columns. Everything else stays
  deterministic (§4.10). With no key, both stages fall back to the rule-based
  analyzer and report `degraded`.
- **One endpoint for the whole pipeline.** `POST /pipeline/runs` composes
  analysis → architecture → database → backend → frontend → security →
  dependencies and answers 202 immediately; the client polls real per-stage
  status (never a synthetic percentage — each `PipelineStage` carries its own
  status, duration, one-line summary, `engine: 'ai' | 'deterministic'` and
  `degraded` flag). Artifacts are a separate endpoint because the bundle is
  megabytes and the run object is polled every second.
- **Auth is real.** The `auth` scaffold became a local identity provider:
  bcrypt hashes, JWT access/refresh tokens in httpOnly cookies
  (`nexarch_session` / `nexarch_refresh`, the latter scoped to the auth path),
  a single-flight refresh-and-replay interceptor on the client, and
  `requireAuth` guarding the pipeline subtree. There is no third-party
  sign-in, by design.
- **Preview runs the project.** The Preview page (`/preview/:runId`) hands the
  run's file set to the Local Run Engine and frames the resulting app from its
  own localhost port, beside a file explorer over the real generated tree and
  live logs. Child processes are now swept on signalled shutdown, not just
  clean exit.
- **GitHub removed from the product.** The module, feature, service, route and
  nav entry are gone; generated CI/CD workflow artifacts stay.

## 10. Where to dig deeper

| Document                                                 | What it holds                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `README.md`                                              | Current usage-facing docs: stack, commands, API table, roadmap              |
| `server/src/modules/pipeline/`                           | The product path end to end — start at `pipeline.service.ts`                |
| `server/src/modules/pipeline/lib/ai-stages.ts`           | **The only two model calls in the platform**, and the degradation rules     |
| `server/src/modules/ai-orchestrator/lib/model-router.ts` | The routing table + the test-mode pin (§4.11)                               |
| `server/src/modules/auth/`                               | Identity: `lib/password.ts`, `lib/tokens.ts`, `lib/cookies.ts`, middleware  |
| `client/src/shared/services/api-client.ts`               | The single axios instance + refresh-and-replay interceptor                  |
| `docs/v2/NEXARCH_V2_ARCHITECTURE.md`                     | The 2.0 design: 15 named agents, message protocol, memory/learning systems, |
|                                                          | quality gates, roadmap M0–M9, research-paper outline, commercialization —   |
|                                                          | **design only, additive-only (`server/src/agents/` when implemented)**      |
| `FINAL_PROJECT_SUMMARY.md`                               | Narrative wrap-up of the original 12-phase build. **Historical — predates   |
|                                                          | Phases 13 and 14; trust this file over it wherever they disagree.**         |
| `reports/`                                               | Machine-readable audit artifacts (quality-summary, architecture audit,      |
|                                                          | live smoke test of the full pipeline). Also pre-Phase-14.                   |
| `server/prisma/schema.prisma`                            | Data model with reasoning in doc comments                                   |
| `server/src/shared/types/`                               | The contracts everything else obeys                                         |

---

Made by [Ashutosh Sharma](https://www.linkedin.com/in/ashutoshsharma1309/)
