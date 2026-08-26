# NexArch

AI-powered secure full-stack application generation. Describe an application in plain
language — NexArch analyzes the requirements, plans the architecture, designs the
database, generates hardened backend and frontend code, and keeps regenerating
incrementally as the requirements evolve.

**Status: all 12 build phases complete, plus Phase 13 — End-to-End Application
Lifecycle.** Requirement analysis, architecture planning,
database design, backend generation, frontend generation, security hardening,
dependency-aware regeneration, AI orchestration, workspace/project management,
deployment infrastructure generation, and quality/testing/documentation are all live
end to end. See [`docs/v2/NEXARCH_V2_ARCHITECTURE.md`](docs/v2/NEXARCH_V2_ARCHITECTURE.md)
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

Requirements: Node ≥ 22, npm ≥ 10, and a MySQL 8+ server (Docker Compose ships one).

```bash
npm install                              # installs both workspaces + git hooks
cp server/.env.example server/.env       # then set AI_API_KEY (see below)
npm run docker:dev                       # start MySQL 8.4 in Docker
npm run db:push                          # sync the Prisma schema
npm run dev                              # API on :4000, console on :5173
```

Open http://localhost:5173, create an account, and describe an application in the
Forge. The console proxies `/api` to the server, and the top bar shows live API health.

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
    analysis/            # implemented: NL requirement analysis → structured spec
    architecture/        # implemented: requirement spec → Software Design Spec
    database-designer/   # implemented: SDS → schemas, ER, OpenAPI, validation
    backend-generator/   # implemented: SDS + design → generated Express/Prisma backend
    frontend-generator/  # implemented: SDS + design → generated React/Vite frontend
    security-engine/     # implemented: JWT/RBAC hardening + security analysis of output
    dependency-graph/    # implemented: change impact analysis + incremental regeneration
    ai-orchestrator/     # implemented: multi-provider model routing, retries, workflows
    workspace/           # implemented: projects, generation history, export
    deployment/          # implemented: deployment infra generation (12 targets)
    quality/             # implemented: quality scoring, testing, docs, release readiness
    insights/            # implemented: automatic architecture analysis, diagrams, scores
    runner/              # implemented: one-click local runs with ports, logs, diagnostics
    pipeline/            # implemented: prompt -> analysis -> plan -> code -> hardening -> graph
    auth/                # implemented: local accounts, JWT cookie sessions, role guards
    review/              # scaffold: static analysis + optimization
  shared/                # config, logger, middleware, database client, types, utils
  app.ts                 # middleware pipeline + module mounting (no socket, no DB)
  index.ts               # process lifecycle: boot, listen, graceful shutdown

client/src/
  features/           # dashboard, prompt (forge), architecture, database, backend,
                       # frontend, backend generator, deployment, quality, ...
  shared/             # design-system components, layouts, hooks, services, stores
  app/                # router + 404
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

All routes live under `/api/v1`, grouped by module:

| Module                | Base path       | Key routes                                                                                                                                                                          |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health`              | `/health`       | `GET /`, `GET /live`, `GET /ready`                                                                                                                                                  |
| `analysis`            | `/analyze`      | `POST /` — prompt → structured requirement spec                                                                                                                                     |
| `architecture`        | `/architecture` | `POST /` — spec → Software Design Spec                                                                                                                                              |
| `database-designer`   | `/database`     | `POST /design` — SDS → schemas, ER, validation                                                                                                                                      |
| `database-designer`   | `/openapi`      | `POST /generate` — OpenAPI 3.1 contract from SDS + design                                                                                                                           |
| `backend-generator`   | `/backend`      | `POST /generate` — SDS + design → Express/Prisma project                                                                                                                            |
| `frontend-generator`  | `/frontend`     | `POST /generate` — SDS + design → React/Vite project                                                                                                                                |
| `security-engine`     | `/security`     | `POST /analyze`, `POST /apply`, `GET /report`                                                                                                                                       |
| `dependency-graph`    | `/dependency`   | `POST /build`, `POST /analyze`, `POST /regenerate`, `GET /graph`, `GET /statistics`                                                                                                 |
| `ai-orchestrator`     | `/ai`           | `POST /generate`, `POST /retry`, `POST /workflow`, `GET /history`, `GET /statistics`                                                                                                |
| `workspace`           | `/`             | `GET`/`POST`/`PATCH`/`DELETE /project(s)`, `POST /project/:id/duplicate`, `POST /project/:id/generations`, `GET /history`, `GET /statistics`, `POST /export`, `POST /documentation` |
| `deployment`          | `/deployment`   | `POST /generate`, `POST /export`, `GET /status`, `GET /health`                                                                                                                      |
| `quality`             | `/`             | `POST /quality/analyze`, `POST /quality/export`, `GET /quality/report`, `POST /testing/run`, `POST /documentation/generate`, `GET /performance/report`, `GET /release/readiness`    |
| `auth` _(scaffold)_   | `/auth`         | manifest only — Phase 3 scope: registration, JWT sessions, role guards                                                                                                              |
| `review` _(scaffold)_ | `/review`       | manifest only — static analysis + optimization pass                                                                                                                                 |

Success and failure envelopes are documented in `server/src/shared/types/api.ts` and
mirrored in `client/src/shared/types/api.ts`.

### Database

Prisma + MySQL. Phase 1 models: `Role`, `User`, `Project`, `Generation` — the platform's
own bookkeeping (who, what they own, and the audit trail of pipeline runs). See
`server/prisma/schema.prisma` for the reasoning captured in doc comments.

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

All 12 build phases are complete:

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
