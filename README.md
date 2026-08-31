# NexArch

AI-powered secure full-stack application generation. Describe an application in plain
language — NexArch analyzes the requirements, plans the architecture, designs the
database, generates hardened backend and frontend code, and keeps regenerating
incrementally as the requirements evolve.

**Status: NexArch v2.0 — frozen release candidate (through Phase 17).** All core
build phases are complete and validated: requirement analysis, a multi-agent
planning/generation/review/runtime/test mesh, a self-repair loop, an engineering graph,
a context/token engine, security hardening, workspace/project management, a one-click
local runner/preview, guided onboarding, a deterministic Demo Mode, and portable
project export/import — all live end to end. Phase 16 audited the whole surface and
closed every unauthenticated/cross-tenant gap; Phase 17 prepared a reproducible,
demo-ready release. See
[`docs/v2/NEXARCH_V2_ARCHITECTURE.md`](docs/v2/NEXARCH_V2_ARCHITECTURE.md)
for the forward-looking multi-agent design (v2.0 is a design document only — nothing
in it is implemented, and it does not change anything described below).

---

## Stack

| Layer   | Technology                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Client  | React 19 · Vite · TypeScript · TailwindCSS 4 · React Router · TanStack Query · Zustand · React Hook Form · Zod · Axios · Framer Motion |
| Server  | Node.js 22 · Express 5 · TypeScript · Prisma · MySQL · Helmet · CORS · express-rate-limit · express-validator · Morgan · Winston · Zod |
| Tooling | npm workspaces · ESLint (typed, flat config) · Prettier · Husky + lint-staged · GitHub Actions · Docker + Compose                      |

## Getting started

Requirements: Node ≥ 22 and npm ≥ 10. **No database and no login are required** — by
default NexArch runs entirely in memory as a single local user.

```bash
npm install                              # installs both workspaces + git hooks
cp server/.env.example server/.env       # then set AI_API_KEY (see below)
npm run dev                              # API on :4000, console on :5173
```

Open http://localhost:5173 — you land straight in the app, no sign-in. Describe an
application and build it. The console proxies `/api` to the server, and the top bar shows
live API health.

> **Zero-setup mode (default).** With no `DATABASE_URL` set, projects, the engineering
> graph and run history live in process memory and reset when the server restarts. This
> is the intended local/demo mode.
>
> **Add a database later** (optional, for persistence): start MySQL
> (`npm run docker:dev`), set `DATABASE_URL` in `server/.env`, run `npm run db:push`, and
> restart. **Turn real accounts back on**: set `AUTH_DISABLED=false` and a real
> `JWT_SECRET` (min 32 chars). The login/onboarding UI returns automatically.

### First run: onboarding & demo

The app opens on a short welcome that lays out the four steps of a run — create a
project, describe it, build, explore — and offers two ways to take the first one:
describe your own application, or open the demo. (In the default no-auth mode the
welcome state lives in memory, so it resets with the server.)

**Demo Mode** is the fastest way to see the whole pipeline without a prompt or a key.
Click **Try the demo** (on the home screen or the Projects page, or from the welcome).
It builds a fixed sample — an AI-powered project-management SaaS — from the platform's
own _deterministic_ generators, so it needs no model, no external service, and no
credentials, and it produces the same result every time. The demo carries a synthetic
review (findings, one repaired, a passing-with-warnings validation) so it tells the
whole generate → review → repair → validate story end to end. It is labelled **Demo**
everywhere it appears and can be reset — clicking **Try the demo** again rebuilds it in
place — so it can never be mistaken for one of your real projects.

### Portable projects (export/import)

Any project can be exported to a single self-describing JSON file — the **NexArch
Project Package** (`schemaVersion: 1`) — from the ⋯ menu on its card. A package carries
the project's metadata, its latest specification artifacts, its engineering graph, its
findings, its validation summary and its repair history — its _state_, never its
secrets. Every value is walked through the same redactor that guards the logs before it
becomes a file, so an export never contains a password, an API key, a session token or a
provider credential.

**Import** (the button on the home or Projects page) reads a package and creates a _new_
project from it — it never overwrites an existing one. Import is the adversarial
direction and is treated that way: the package is untrusted, so its schema version is
checked, its size is bounded, its artifact file paths are rejected if they traverse or
absolute-escape, its graph edges are validated, and nothing in it is ever executed. A
malformed or hostile package is rejected with a reason, not partially applied.

### The AI key

NexArch calls a real model for requirement analysis and entity design. Set one key in
`server/.env`:

```
AI_PROVIDER=groq
AI_API_KEY=your-key-here
```

`AI_PROVIDER` also accepts `claude`, `openai`, `gemini`, `openrouter` and `mock`;
`AI_MODEL_FAST` / `AI_MODEL_DEEP` override the models per tier. The key is read
**server-side only** — it never appears in an API response, the client bundle, or a
browser request. Without a key the platform still runs end to end: the AI stages fall
back to the built-in rule-based analyzer and report themselves as degraded rather than
failing.

### Ports

Everything that listens on localhost, and why they never collide:

| Port    | What                                                           |
| ------- | -------------------------------------------------------------- |
| `5173`  | NexArch console (Vite dev server)                              |
| `4000`  | NexArch API                                                    |
| `3306`  | MySQL (the platform's own database)                            |
| `4001+` | A previewed project's **generated backend** (first free port)  |
| `5174+` | A previewed project's **generated frontend** (first free port) |

Preview processes get free ports scanned at start time, so running a preview never
takes NexArch down — the console stays fully usable beside it, and every preview is
stopped when the API process exits.

### Everyday commands

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | Run server + client concurrently                   |
| `npm run build`      | Production builds of both workspaces               |
| `npm test`           | Server suites (node:test) + client suites (Vitest) |
| `npm run lint`       | Typed ESLint across both workspaces                |
| `npm run typecheck`  | Strict TypeScript checks                           |
| `npm run format`     | Prettier over the whole repo                       |
| `npm run db:migrate` | Create/apply a Prisma migration                    |
| `npm run db:studio`  | Prisma Studio against the dev database             |
| `npm run docker:up`  | Full production-shaped stack (MySQL + API + nginx) |

Generation runs and preview sessions live in the API process's memory, so restarting
the server clears them — generate again to get a fresh run.

## Architecture

Two npm workspaces, both **feature-first** — code is grouped by what it does for the
product, not by what kind of file it is.

```
server/src/
  modules/               # one folder per domain capability, mounted by the module loader
    health/              # implemented: liveness, readiness, dependency diagnostics
    auth/                # local accounts, JWT httpOnly-cookie sessions, role guards
    analysis/            # NL requirement analysis → structured spec
    architecture/        # requirement spec → Software Design Spec
    database-designer/   # SDS → schemas, ER, OpenAPI, validation
    backend-generator/   # SDS + design → generated Express/Prisma backend
    frontend-generator/  # SDS + design → generated React/Vite frontend
    security-engine/     # JWT/RBAC hardening + security analysis of output
    dependency-graph/    # change impact analysis + incremental regeneration
    agent-orchestrator/  # the 14-agent mesh: DAG scheduler, artifact/finding/repair
                         #   stores, self-repair loop, validation mesh, result cache
    engineering-graph/   # Prisma-persisted knowledge graph (nodes/edges) + validation
    context-engine/      # graph-keyed context assembly, token budgets, sanitizer
    ai-orchestrator/     # multi-provider model routing, retries, workflows
    pipeline/            # one-call prompt → analysis → plan → code → hardening → graph
    runner/              # one-click local runs with ports, logs, diagnostics (owner-scoped)
    workspace/           # projects, generation history, export/import, demo
    deployment/          # deployment infra generation (credential-gated, out of scope for v2)
    quality/ · insights/ # quality scoring, testing, docs; architecture insights
    review/              # scaffold: static analysis + optimization (not wired)
  shared/                # config, logger, middleware, database client, security, types, utils
  app.ts                 # middleware pipeline + module mounting (no socket, no DB)
  index.ts               # process lifecycle: boot, listen, graceful shutdown

client/src/
  features/
    home/             # landing + first-run onboarding welcome
    auth/             # login / register / route guard
    projects/         # project list, cards, create/rename/duplicate/delete, export/import
    workspace/        # the per-project workspace: tabs (build, requirements, architecture,
                       #   database, code, preview, intelligence) + the engineering-graph view
    search/           # command palette
    settings/         # preferences
  shared/             # design-system components, layouts, hooks, services, stores, lib
  app/                # router, legacy redirects, error + 404
```

Key rules the codebase enforces by convention:

- **Modules are islands.** A server module owns its URL subtree and internals; modules
  share code only through `shared/`. Adding a feature = adding a folder + one line in
  the module registry.
- **One error pathway.** Everything throws `AppError` (or gets normalized into one);
  a single handler turns errors into the stable JSON envelope. Every response carries
  an `X-Request-Id` that appears in the server logs.
- **Config is validated at boot.** `process.env` is read in exactly one file, through a
  Zod schema; a misconfigured server refuses to start.
- **The client never sees axios or envelopes.** Features consume typed hooks; the HTTP
  layer unwraps envelopes and normalizes failures once.

### API

All routes live under `/api/v1`. Every route requires an authenticated session (the
JWT httpOnly cookie) **except** the public ones noted below. Cross-tenant access is
denied — a resource that isn't yours returns `404`, never another user's data.

| Group                | Auth   | Key routes                                                                                                                                                                                                                              |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`               | public | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/refresh`                                                                                                                                                                   |
| `auth`               | authed | `GET /auth/me`, `POST /auth/onboarding/complete`                                                                                                                                                                                        |
| `health`             | public | `GET /health`, `/health/live`, `/health/ready`                                                                                                                                                                                          |
| `workspace`          | authed | projects `GET·POST·PATCH·DELETE`, `POST /project/:id/duplicate`, `GET /project/:id/export`, `POST /projects/import`, `POST /demo`, `GET /project/:id/runs`, `GET /history`, `GET /statistics`                                           |
| `agent-orchestrator` | authed | `POST /projects/:id/agent-runs` (the 14-agent build), `GET .../agent-runs[/:runId[/tasks·events·artifacts]]`, `GET /projects/:id/findings`, `/engineering-review`, `/validation`, `/intelligence/summary`, `POST /projects/:id/repairs` |
| `engineering-graph`  | authed | `GET /projects/:id/graph`, `/graph/validate`, `/graph/nodes/:id[/dependencies·dependents·path]`, `/graph/impact/:id`                                                                                                                    |
| `pipeline`           | authed | `POST /pipeline/runs` (one-call build), `GET /pipeline/runs[/:id[/artifacts]]`, `POST /pipeline/runs/:id/retry`                                                                                                                         |
| `runner`             | authed | `POST /runner/sessions` (local run), `GET /runner/sessions[/:id[/logs]]`, `POST /runner/sessions/:id/stop·restart`                                                                                                                      |
| generators           | authed | `analysis`, `architecture`, `database`, `openapi`, `backend`, `frontend`, `security`, `dependency`, `ai`, `context-engine`, `quality`, `insights`, `deployment`                                                                         |

Every response is a stable envelope carrying an `X-Request-Id`; success and failure
shapes are defined in `server/src/shared/types/api.ts` and mirrored on the client.

### Database

Prisma + MySQL. Durable models: `Role`, `User`, `Project`, `Generation` (the run audit
trail), and the engineering graph — `GraphNode` / `GraphEdge`. Every child row cascades
from its `Project`, which cascades from its `User`; per-owner uniqueness (`ownerId+slug`)
and graph uniqueness (`projectId+type+canonicalName`, `source+target+relationship`)
prevent duplicates. Migrations live in `server/prisma/migrations`; `npm run db:migrate`
applies them, `npm run db:push` syncs the schema for local dev.

Everything else a run produces — artifacts, findings, repairs, validation, the
agent-result cache, live runner sessions — is held in **process-local memory** by design
(it is high-churn and cheap to recompute). It is fully consistent within a server
process; a restart drops it while projects and the graph persist. See
`server/prisma/schema.prisma` for the reasoning in doc comments.

## Agent system

A build is run by a **mesh of 14 agents** on a dependency-ordered DAG
(`agent-orchestrator`). Read-only agents run in parallel waves; each writes typed
artifacts that the next consumes. Agents are grouped into four meshes:

| Mesh         | Agents                                                                                        | Produces                                                                   |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Planning     | requirement-analyst, product-architect, architecture-agent, database-architect, api-architect | requirement spec, product spec, architecture plan, DB design, API contract |
| Generation   | backend-engineer, frontend-engineer, ux-ui-engineer                                           | backend + frontend metadata, generation manifest                           |
| Review       | security-engineer, dependency-engineer, code-quality-engineer                                 | findings (typed, with severity + evidence)                                 |
| Runtime/Test | runtime-engineer, integration-engineer, test-engineer                                         | build/startup/health/integration/test validation                           |

Each agent declares its inputs and outputs; the scheduler blocks an agent until its
inputs exist, marks failures without hanging the run, and records per-agent status,
duration, tokens and result. Deterministic generators back the planning/generation
agents so the pipeline runs (in degraded, rule-based form) even with no model key.

### Engineering graph

Every run projects its artifacts into a persisted knowledge graph
(`engineering-graph`): `PROJECT → REQUIREMENT → FEATURE → SERVICE/MODULE/API →
ENTITY/FIELD → FILE`, plus `FINDING` and `TEST` nodes. It answers "what depends on
this?" (impact analysis for incremental regeneration) and is validated for
consistency (`GET /projects/:id/graph/validate` — no orphan edges, no dangling
references). Nodes are addressed by a stable `canonicalName`, not a database id, so a
re-imported project's graph is self-consistent.

### Self-repair

The review mesh's findings feed a bounded **self-repair loop**: eligibility → root
cause → repair plan → patch → re-validate. A repair is applied to an in-memory,
versioned copy of the artifacts; if re-validation regresses, the changeset is **rolled
back** and the prior state is restored — a finding is only marked `FIXED` with
validation evidence, never optimistically. Repair history (attempts, changeset, result,
rollback) is recorded per project.

### Context & token optimization

Model cost is controlled on three axes (`context-engine` + the agent cache):
per-task **token budgets**, **graph-version-keyed context assembly** (an agent sees only
the artifacts relevant to its task, sanitized of secrets before the model), and a
**content-addressed agent-result cache** — an agent's output is reused when its inputs,
prompt version and model signature are unchanged, so a re-run pays only for what
actually changed. Every run reports its AI calls, tokens and estimated cost.

## Security

- **Authentication** — off by default (`AUTH_DISABLED=true`): the app runs as one
  built-in local user with no login, for zero-friction local use. Turning it on
  (`AUTH_DISABLED=false` + a real `JWT_SECRET`) restores real accounts: bcrypt password
  hashing, JWT in httpOnly/SameSite/Secure-in-prod cookies, a short access token with a
  longer refresh token scoped to `/auth`, never readable by page script.
- **Authorization & isolation** — the owner-scoping is always in place: every
  data/compute route resolves resources by owner, so another user's project, run,
  session, finding or export reads as `404`. In no-auth mode there is a single owner, so
  everything belongs to the local user; the moment accounts are on, isolation applies
  per account with no further change.
- **Secret handling** — the model key is server-side only; one redactor guards logs and
  the export package, and a sanitizer scrubs context before every model call. No secret
  appears in a response, a log, an artifact, or the export.
- **Path & command safety** — the runner writes generated files only inside a contained
  workspace (traversal/absolute paths rejected); import validates every package path the
  same way and executes nothing from an imported package.
- **Rate limiting** — a global limit plus a tighter one on credential and expensive
  (AI/build) endpoints. Oversized bodies are rejected `400`, not crashed on.
- **AI safety** — prompts are length-bounded and sanitized; the deterministic fallback
  means a missing or throttled provider degrades gracefully rather than failing open.

## Environment variables

Configuration is read once, at boot, through a Zod schema (`server/src/shared/config`);
a misconfigured server refuses to start. Copy `server/.env.example` and fill it in —
it contains placeholders only, never real values.

| Variable                                  | Required  | Purpose                                                                                     | Example                                       |
| ----------------------------------------- | --------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `NODE_ENV`                                | optional  | `development` / `production` / `test`                                                       | `development`                                 |
| `PORT`                                    | optional  | API port                                                                                    | `4000`                                        |
| `DATABASE_URL`                            | optional  | MySQL connection string. **Unset → in-memory mode** (no DB). Set it for persistence.        | `mysql://nexarch:pass@localhost:3307/nexarch` |
| `AUTH_DISABLED`                           | optional  | `true` (default) runs as one built-in local user, no login. `false` turns on real accounts. | `true`                                        |
| `JWT_SECRET`                              | optional* | Signs session tokens (min 32 chars). *Required only when `AUTH_DISABLED=false`.             | `a-long-random-string…`                       |
| `JWT_EXPIRES_IN`                          | optional  | Access-token lifetime                                                                       | `15m`                                         |
| `JWT_REFRESH_EXPIRES_IN`                  | optional  | Refresh-token lifetime                                                                      | `7d`                                          |
| `AI_PROVIDER`                             | optional  | `groq` · `openai` · `claude` · `gemini` · `openrouter` · `mock`                             | `groq`                                        |
| `AI_API_KEY`                              | optional* | Model key — server-side only (*required for real AI; absent → deterministic fallback)       | _(empty)_                                     |
| `AI_MODEL_FAST` / `AI_MODEL_DEEP`         | optional  | Per-tier model overrides                                                                    | provider default                              |
| `CORS_ORIGINS`                            | optional  | Allowed browser origins (dev)                                                               | `http://localhost:5173`                       |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | optional  | Global rate limit                                                                           | `900000` / `100`                              |
| `NEXARCH_RUNNER_MAX_SESSIONS`             | optional  | Concurrent local-run cap                                                                    | `30`                                          |

## Testing

```bash
npm run typecheck                        # tsc across both workspaces
npm run lint                             # eslint (typed rules)
npm test                                 # server unit + client (vitest)
npm run test:integration --workspace server   # DB-backed integration tests
npm run build                            # production build, both workspaces
```

The server suite is Node's built-in test runner (`node --test` via `tsx`); the client
suite is Vitest. Integration tests run against the live MySQL from Docker Compose.

## Troubleshooting

- **API says the database is down** — start MySQL (`npm run docker:dev`) and check
  `DATABASE_URL`; `GET /api/v1/health` reports each dependency's state.
- **AI stages report "degraded"** — no `AI_API_KEY` is set, so the deterministic
  generators are running; set a key to enable the model path.
- **`JWT_SECRET` error at boot** — it must be at least 32 characters.
- **A local run won't start** — it needs a `backend/package.json` or
  `frontend/package.json` with a `dev` script; the run's logs name the cause.
- **Port already in use** — the API is `4000`, the console `5173`; change `PORT` or free
  the port.

## Deployment

`docker compose up --build` produces the production shape: MySQL 8.4, the API
(multi-stage Node image, non-root, healthchecked), and the console (static build behind
nginx, which proxies `/api` so the browser stays on one origin and CORS never applies in
production).

```bash
cp .env.example .env    # set MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD, JWT_SECRET
docker compose up --build
```

Console: http://localhost:8080 · API: http://localhost:4000/api/v1/health

CI (`.github/workflows/ci.yml`) runs lint/typecheck/test/build on every push and PR to
`main`, then builds both Docker images to confirm they stay buildable; publishing the
images and deploying is intentionally left to whichever hosting target you pick.

This is the platform's own deployment setup. Separately, the `deployment` module
(`POST /api/v1/deployment/generate`) generates deployment infrastructure — Dockerfiles,
CI/CD pipelines, env templates — for the applications NexArch generates for you, across
12 targets (Docker Compose, Kubernetes, Vercel, Railway, Fly.io, and others).

## Roadmap

All core build phases are complete:

1. ~~Foundation — workspaces, security middleware, module system, design system~~
2. ~~Requirement Analyzer — prompt → structured spec~~
3. ~~Architecture Planner — spec → Software Design Specification~~
4. ~~Database Designer & API Contract Generator — SDS → schemas + OpenAPI~~
5. ~~Backend Generation Engine — SDS + design → Express/Prisma backend~~
6. ~~Security Engine — JWT auth, RBAC, hardening of generated output~~
7. ~~Frontend Generation Engine — SDS + design → React/Vite frontend~~
8. ~~Dependency Graph Engine — change impact analysis, incremental regeneration~~
9. ~~AI Orchestrator — multi-provider routing, retries, workflows~~
10. ~~Workspace — projects, generation history, export~~
11. ~~Deployment Engine — deployment infrastructure generation across 12 targets~~
12. ~~Quality Engine — quality scoring, test generation, documentation, release readiness~~
13. ~~End-to-End Application Lifecycle — one-click local runs, one-click deploy (Vercel/Railway/Render), prompt-diff incremental regeneration, automatic architecture insights~~
14. ~~Local v1 — real AI in the pipeline, local accounts, one-call end-to-end generation, interactive localhost preview~~
15. ~~SaaS Readiness — first-run onboarding, deterministic Demo Mode, portable project export/import, prompt examples, failure/recovery UX~~
16. ~~Final System Audit & Hardening — full auth/ownership audit; closed every unauthenticated and cross-tenant route; owner-scoped the runner, pipeline and history; fixed a redaction-depth export bug~~
17. ~~Release Engineering & Freeze — reproducible clean install, secret + dependency audit (critical advisory remediated), 10× demo reliability, documentation, release manifest~~

Phase 16 treated the codebase as a release candidate and audited the whole surface:
it closed every route that was reachable unauthenticated, gave the runner, pipeline and
history feeds per-user ownership (cross-tenant access now returns 404), and fixed a
redaction-depth bug that had been corrupting deep artifact content in exports. Phase 17
froze the result — reproducible install, secret and dependency audits, ten clean demo
runs, and this documentation.

Phase 15 made the platform usable from first login: a guided welcome, a credential-free
demo that runs the whole pipeline deterministically, starter prompts, a **Demo** label
and reset so the demo can never be confused with real work, and a portable, secret-free
project package for export/import. No new agents, providers, or deployment surface — it
is the same product, made approachable.

Phase 14 made the platform usable as one product: `POST /pipeline/runs` composes every
stage behind a single prompt, the `auth` module became a real local identity provider
(no third-party sign-in), and the Preview runs the generated project on localhost and
frames it beside its own file explorer and logs.

The deploy providers stay credential-gated: they are fully built and ship disabled
until the relevant provider token is set (see `server/.env.example`) — planning and
status endpoints work without any secrets. Repository hosting is deliberately out of
scope for v1: local files, localhost and the API are the source of truth.

`review` remains an intentional scaffold — static-analysis/optimization review is
future work rather than a blocker for any current capability.

**What's next:** [`docs/v2/NEXARCH_V2_ARCHITECTURE.md`](docs/v2/NEXARCH_V2_ARCHITECTURE.md)
lays out the design for NexArch 2.0 — evolving from a single-model pipeline into a
15-agent autonomous engineering organization. It's a design/roadmap document only;
nothing in it is implemented, and v1's architecture above is unaffected.

---

Made by [Ashutosh Sharma](https://www.linkedin.com/in/ashutoshsharma1309/)
