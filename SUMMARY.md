# NexArch — Project Summary for AI Assistants

> Read this first. It exists so that any LLM (or human) can understand what this
> project is, how it is built, what its invariants are, and how to work on it
> without breaking its conventions. The README covers usage; this file covers
> understanding.

## 1. What this project is

NexArch is an **AI-powered end-to-end software engineering platform**. A user
describes an application in plain language; NexArch analyzes the requirements,
plans the architecture, designs the database, generates hardened backend and
frontend code, wires in security, tracks dependencies for incremental
regeneration, generates deployment infrastructure, and scores the result for
quality and release readiness. Since Phase 13 it also closes the loop after
generation: run the generated project locally with one click (install, port
allocation, log streaming), push it to GitHub, deploy it through provider
abstractions (Vercel/Railway/Render), regenerate incrementally from a prompt
diff, and auto-produce an architecture analysis with diagrams and scores.

Two things matter to keep straight:

- **NexArch itself** is a deterministic TypeScript platform (Express API + React
  console). Its analyzers, planners, and generators are rule/template engines —
  they run without any LLM. The exceptions are the integration modules, all
  gated on optional credentials read at call time: `ai-orchestrator` (LLM calls
  via OpenRouter), `github` (push flow), and `deployment`'s execute layer
  (provider APIs). Without their tokens everything else still works.
- **Generated projects** are the _output_: complete Express/Prisma backends and
  React/Vite frontends with tests, docs, Docker, and CI — produced _by_ the
  platform for the user's described app. Don't confuse the platform's own
  infrastructure with the infrastructure it generates for downstream projects
  (e.g. `server/src/modules/deployment` generates deployment files _for
  generated apps_; the repo-root `docker-compose.yml` deploys _NexArch itself_).

**Status:** v1.1 — all 12 build phases complete plus Phase 13 (End-to-End
Application Lifecycle: local runner, GitHub integration, one-click deploy,
prompt-diff regeneration, insights), verified, and pushed. A
forward-looking multi-agent design for v2.0 exists at
`docs/v2/NEXARCH_V2_ARCHITECTURE.md` but is **design only — nothing in it is
implemented**.

## 2. Stack

| Layer   | Technology                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Server  | Node.js ≥ 22 · Express 5 · TypeScript (strict) · Prisma + MySQL 8.4 · Zod (env) · express-validator · Helmet · Winston · node:test       |
| Client  | React 19 · Vite · TypeScript · TailwindCSS 4 · React Router · TanStack Query · Zustand · React Hook Form · Zod · Axios · Framer Motion   |
| Tooling | npm workspaces (`server/`, `client/`) · typed flat-config ESLint · Prettier · Husky + lint-staged · GitHub Actions CI · Docker + Compose |

Scale: ~282 server TS files (~35k LOC), ~128 client TS/TSX files (~14k LOC),
257 server tests (`node:test`) + 24 client tests (Vitest + Testing Library) —
281 total, all green.

## 3. Repository layout

```
package.json              # npm workspaces root; all everyday commands live here
docker-compose.yml        # NexArch's own production-shaped stack (MySQL + API + nginx console)
docker-compose.dev.yml    # dev MySQL only
.github/workflows/ci.yml  # verify job (lint/typecheck/test/build) + docker job (builds both images)
.env.example              # Compose-level vars (MYSQL_*, JWT_SECRET, ports)
docs/v2/                  # NexArch 2.0 multi-agent DESIGN document (not implemented)
reports/                  # generated audit artifacts from the final integration pass
FINAL_PROJECT_SUMMARY.md  # narrative wrap-up of the 12-phase build

server/
  .env.example            # the API's own runtime env contract (DATABASE_URL, JWT_*, CORS_ORIGINS…)
  prisma/schema.prisma    # Role, User, Project, Generation (platform bookkeeping)
  src/
    index.ts              # process lifecycle: boot, listen, graceful shutdown
    app.ts                # middleware pipeline + module mounting; no socket, no DB
    modules/              # 17 feature modules — see catalog below
      index.ts            # THE module registry; a module exists iff it is listed here
    shared/               # the ONLY code modules may share
      config/env.ts       # every process.env read in the codebase, Zod-validated at boot
      database/prisma.ts  # prisma client + connect/disconnect
      logger/             # Winston logger
      middleware/         # error-handler, rate-limiter, request-context, request-logger, security, validate
      types/              # api envelope, module contract, requirement/architecture/design types
      utils/              # api-response, app-error, module-scaffold, strings

client/
  src/
    app/                  # router + 404
    features/             # one folder per console page (22: dashboard, prompt, architecture, database,
                          #   backend, frontend, security, dependency-graph, ai-orchestrator, projects,
                          #   deployment, quality, insights, runner, github, documentation, exports,
                          #   generation, logs, notifications, search, settings)
    shared/
      services/           # one <module>.service.ts per server module + api-client.ts (the only axios use)
      components/ layouts/ hooks/ lib/ store/ styles/ types/
  nginx.conf              # prod serving: SPA fallback + /api proxy to the server container
```

## 4. Architectural invariants (do not break these)

1. **Modules are islands.** A server module owns its URL subtree and internals.
   Modules NEVER import from each other's internals — shared code lives only in
   `server/src/shared/`. This was audited at 0 violations; keep it there.
2. **One module contract.** Every module exports an `AppModule`
   (`{ name, basePath, description, router }`, see `shared/types/module.ts`) and
   is mounted by adding exactly one line to `server/src/modules/index.ts`.
3. **Consistent module file layout.** `index.ts` (the AppModule),
   `<name>.router.ts`, `<name>.controller.ts`, `<name>.service.ts`,
   `<name>.validator.ts`, `<name>.types.ts`, `<name>.service.test.ts`, and
   `lib/` for the real machinery. Layering: types → lib → service → validator →
   controller → router.
4. **One error pathway.** Throw `AppError` (or let the handler normalize);
   a single error handler emits the stable JSON envelope. Every response carries
   `X-Request-Id` (also in `meta.requestId`), joinable against server logs.
5. **One response envelope.** Every JSON response is `ApiSuccess<T>` or
   `ApiFailure` (`shared/types/api.ts`); clients branch on `success`. The
   client mirrors these types in `client/src/shared/types/api.ts` (a single
   large type-mirror file — an accepted convention, don't split casually).
6. **Config is validated at boot.** `process.env` is read in exactly one file
   (`shared/config/env.ts`) through Zod; a misconfigured server refuses to
   start. Never read `process.env` elsewhere. Documented exception: optional
   integration credentials and knobs are checked at call time in their
   provider/lib files so the platform boots and runs without them —
   `OPENROUTER_API_KEY` (ai-orchestrator), `GITHUB_TOKEN` (github),
   `VERCEL_TOKEN`/`RAILWAY_TOKEN`/`RENDER_API_KEY` (deployment execute), and
   `NEXARCH_RUNNER_DIR`/`NEXARCH_RUNNER_MAX_SESSIONS`/`NEXARCH_RUNNER_DATABASE_URL`
   (runner — the last one names a MySQL server whose user can CREATE DATABASE;
   each run session then gets its own isolated `nexarch_run_<project>` schema,
   and without it generated backends boot in degraded mode).
7. **The client never sees axios or envelopes.** Features consume typed hooks →
   services → `api-client.ts`, which unwraps envelopes and normalizes failures
   once.
8. **Tests run against real artifacts.** Server `*.service.test.ts` suites
   drive the actual upstream pipeline (real analyzer → planner → generator
   output) rather than hand-shaped fixtures. Follow that pattern.
9. **app.ts owns wiring, index.ts owns lifecycle.** `createApp()` touches no
   socket and no DB (supertest-able); process boot/shutdown lives in
   `index.ts`. In development the API boots in degraded mode without MySQL;
   in production it refuses to start.

## 5. Module catalog (server, all under `/api/v1`)

Pipeline order — each stage consumes the previous stage's structured output:

| #   | Module                | Base path       | What it does                                                                                                        |
| --- | --------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | `health`              | `/health`       | `GET /`, `/live`, `/ready` — diagnostics; 503 + degraded report when MySQL is down                                  |
| 2   | `analysis`            | `/analyze`      | `POST /` — natural-language prompt → structured requirement spec (entities, features, roles, constraints)           |
| 3   | `architecture`        | `/architecture` | `POST /` — requirement spec → Software Design Spec (SDS): tech choices, module plan, folder plan, API plan, scaling |
| 4   | `database-designer`   | `/database`     | `POST /design` — SDS → schemas (Prisma/SQL), ER model, validation rules                                             |
|     | (same module)         | `/openapi`      | `POST /generate` — OpenAPI 3.1 contract from SDS + design                                                           |
| 5   | `backend-generator`   | `/backend`      | `POST /generate` — SDS + design → complete Express/Prisma backend project (files as structured output)              |
| 6   | `security-engine`     | `/security`     | `POST /analyze`, `POST /apply`, `GET /report` — JWT/RBAC hardening + security analysis of generated output          |
| 7   | `frontend-generator`  | `/frontend`     | `POST /generate` — SDS + design → complete React/Vite frontend project                                              |
| 8   | `dependency-graph`    | `/dependency`   | `POST /build`, `/analyze`, `/diff` (old spec vs new spec → selective regeneration plan), `/regenerate`,             |
|     |                       |                 | `GET /graph`, `/statistics` — change-impact analysis, prompt-diff incremental regeneration                          |
| 9   | `ai-orchestrator`     | `/ai`           | `POST /generate`, `/retry`, `/workflow`, `GET /history`, `/statistics` — LLM routing via OpenRouter (needs API key) |
| 10  | `workspace`           | `/`             | Projects CRUD (`/projects`, `/project/:id`, duplicate, generations), `/history`, `/statistics`, `/export` (zip),    |
|     |                       |                 | `/documentation` — persistence layer over Prisma                                                                    |
| 11  | `deployment`          | `/deployment`   | `POST /generate`, `/export`, `GET /status`, `/health` — deployment infra for GENERATED apps across 12 targets.      |
|     |                       |                 | Phase 13 execute layer: `GET /providers`, `POST /execute/plan`, `POST /execute`, `GET /executions(/:id)` —          |
|     |                       |                 | provider abstraction (Vercel/Railway/Render), state machine queued→building→deploying→live/failed, token-gated      |
| 12  | `quality`             | `/`             | `/quality/analyze`, `/quality/export`, `/quality/report`, `/testing/run`, `/documentation/generate`,                |
|     |                       |                 | `/performance/report`, `/release/readiness` — scoring (9 categories, A–F), test generation, docs, benchmarks        |
| 13  | `insights`            | `/insights`     | `POST /generate` — automatic architecture analysis: summary, "why this tech?" justifications quoting planner        |
|     |                       |                 | decisions, folder/db/api/security explanations, Mermaid architecture/ER/API-flow diagrams, explained scores         |
| 14  | `github`              | `/github`       | `GET /status`, `/user`, `/repositories(/:owner/:repo)`, commits; `POST /repositories`, `/branches`,                 |
|     |                       |                 | `/push/plan` (works untokened), `/push` — full GitHub service layer via Git Data API, gated on `GITHUB_TOKEN`       |
| 15  | `runner`              | `/runner`       | `POST /plan`, `/sessions`, `/sessions/:id/stop`, `/restart`; `GET /sessions(/:id)`, `/sessions/:id/logs` —          |
|     |                       |                 | one-click local run: workspace write, install, free-port allocation, log streaming (cursor), failure diagnostics    |
| —   | `auth` _(scaffold)_   | `/auth`         | Manifest only. Planned: registration, JWT sessions, `requireAuth`/`requireRole`. Deps + config already wired.       |
| —   | `review` _(scaffold)_ | `/review`       | Manifest only. Planned: static analysis + optimization pass gating REVIEWING → COMPLETED.                           |

Each module keeps its real machinery in `lib/` (e.g. `architecture/lib/` has
technology-engine, module/database/api/folder/frontend/security/scalability
planners; `quality/lib/` has analyzers, scorers, and unit/api/e2e/frontend test
generators).

## 6. Data model (platform's own, Prisma + MySQL)

Four models — the platform's bookkeeping, not generated-app data:

- **Role** → **User** (bcrypt `passwordHash`, nullable until auth ships)
- **User** → **Project** (slug, status DRAFT/ACTIVE/ARCHIVED)
- **Project** → **Generation** — one pipeline run each; status mirrors the
  pipeline (PENDING → ANALYZING → PLANNING → GENERATING → REVIEWING →
  COMPLETED/FAILED) so progress can stream and failed runs can resume.

## 7. How to run it

```bash
# Dev (recommended while working)
npm install
cp server/.env.example server/.env   # defaults work with the dev database
npm run docker:dev                   # MySQL 8.4 in Docker
npm run db:push
npm run dev                          # API :4000, console :5173 (Vite proxies /api)

# Production shape (all in Docker: MySQL + API + nginx console)
cp .env.example .env                 # set MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD, JWT_SECRET
docker compose up --build            # console :8080, API :4000
```

Verification suite (run all before committing; CI runs the same):

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
```

Notes:

- Dockerfiles use the REPO ROOT as build context (`docker build -f server/Dockerfile .`)
  and pass `--ignore-scripts` to `npm ci` (the root `prepare` script runs husky,
  which isn't installed by `npm ci --workspace <name>` — this was a real bug, fixed).
- If host port 3306 is occupied by a local MySQL, set `MYSQL_PORT=3307` in `.env`.
- `OPENROUTER_API_KEY` (optional) enables real LLM calls in `ai-orchestrator`;
  everything else works without it.
- Phase 13 integration tokens (all optional, same provider-key convention):
  `GITHUB_TOKEN` (push flow), `VERCEL_TOKEN` / `RAILWAY_TOKEN`+ids /
  `RENDER_API_KEY`+`RENDER_SERVICE_ID` (one-click deploy),
  `NEXARCH_RUNNER_DIR` / `NEXARCH_RUNNER_MAX_SESSIONS` /
  `NEXARCH_RUNNER_DATABASE_URL` (runner knobs — the DB URL gives each run its
  own provisioned MySQL schema; without it runs boot in degraded mode).
  Everything is built and gated — only final execution needs the tokens.

## 8. Conventions an assistant must follow

- **Adding a server capability** = new folder in `server/src/modules/<name>/`
  following the file layout in §4.3 + one registry line in `modules/index.ts` +
  a client service/feature if it has UI. Nothing else changes.
- **Comments explain why, not what.** The codebase carries deliberate header
  comments documenting decisions; match that density and tone.
- **Commit style:** detailed "why not just what" messages; subject in
  imperative mood. Never commit `.vscode/settings.json` (stray local file).
  Never commit `.env` (gitignored; `.env.example` files are the contract).
- **Verification before commit** is non-negotiable: lint, typecheck, tests,
  build, format:check must all pass (Husky + lint-staged also enforce on
  commit).
- **Prettier owns formatting** — run `npm run format` rather than hand-aligning.

## 9. Known gaps and accepted tradeoffs (as of v1.1)

- `auth` and `review` are intentional scaffolds (§5). The console is currently
  single-workspace with no login; downstream generated apps DO get full
  JWT/RBAC from the security-engine regardless.
- ~~No automated client test suite~~ — closed: the client now has a Vitest +
  Testing Library suite (`client/src/**/*.test.ts(x)`, run by `npm test`)
  covering the HTTP error layer, stores, design-system components, the
  sidebar/nav contract, and the runner log-accumulator hook.
- `client/src/shared/types/api.ts` is a single ~1500-line type-mirror file —
  known, accepted convention; don't split it without cause.
- CI builds Docker images but doesn't push/deploy them — publishing is
  deliberately deferred to whichever hosting target is chosen.
- Vercel can host the client only; the API needs a persistent-process host
  (Railway/Render/Fly) plus managed MySQL.
- Phase 13's deploy-execute flows are fully built but remain disabled until
  their tokens are configured (§4.6) — plan/status endpoints work untokened;
  only final execution is gated. Generation runs, runner sessions and deploy
  executions live in process memory, not the database: a server restart
  forgets them (the child processes are killed on shutdown), which fits a
  local single-user console but would need persistence for multi-user hosting.

## 9b. Phase 14 — local v1

The platform became one product instead of a set of independently callable
stages:

- **Real AI in the pipeline.** A Groq adapter joins the provider registry, and
  the routing table is now configuration (`AI_PROVIDER`, `AI_MODEL_FAST`,
  `AI_MODEL_DEEP`). Two stages call a model: the Requirement Analyzer produces
  the `RequirementSpec`, and the Architecture stage designs each entity's
  business columns. Everything else stays deterministic — the model supplies
  semantics, code supplies structure, which is what keeps a run to two bounded
  calls (~3k tokens, ~$0.001) instead of eight open-ended ones. With no key,
  both stages fall back to the rule-based analyzer and report `degraded`.
- **One endpoint for the whole pipeline.** `POST /pipeline/runs` composes
  analysis → architecture → database → backend → frontend → security →
  dependencies and answers 202 immediately; the client polls real per-stage
  status (never a synthetic percentage). Artifacts are a separate endpoint
  because the bundle is megabytes and the run object is polled every second.
- **Auth is real.** The `auth` scaffold became a local identity provider:
  bcrypt hashes, JWT access/refresh tokens in httpOnly cookies, a
  refresh-and-replay interceptor on the client, and `requireAuth` guarding the
  pipeline subtree. There is no third-party sign-in, by design.
- **Preview runs the project.** The Preview page hands the run's file set to
  the Local Run Engine and frames the resulting app from its own localhost
  port, beside a file explorer over the real generated tree and live logs.
  Child processes are now swept on signalled shutdown, not just clean exit.
- **GitHub removed from the product.** The module, feature, service, route and
  nav entry are gone; generated CI/CD workflow artifacts (which describe the
  _user's_ future deployment) stay.

## 10. Where to dig deeper

| Document                             | What it holds                                                               |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `README.md`                          | Current usage-facing docs: stack, commands, API table, roadmap (all done)   |
| `docs/v2/NEXARCH_V2_ARCHITECTURE.md` | The 2.0 design: 15 named agents, message protocol, memory/learning systems, |
|                                      | quality gates, roadmap M0–M9, research-paper outline, commercialization —   |
|                                      | **design only, additive-only (`server/src/agents/` when implemented)**      |
| `FINAL_PROJECT_SUMMARY.md`           | Narrative wrap-up of the 12-phase build                                     |
| `reports/`                           | Machine-readable audit artifacts (quality-summary, architecture audit,      |
|                                      | live smoke test of the full 27-call pipeline)                               |
| `server/prisma/schema.prisma`        | Data model with reasoning in doc comments                                   |
| `server/src/shared/types/`           | The contracts everything else obeys                                         |

---

Made by [Ashutosh Sharma](https://www.linkedin.com/in/ashutoshsharma1309/)
