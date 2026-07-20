# NexArch

AI-powered secure full-stack application generation. Describe an application in plain
language — NexArch analyzes the requirements, plans the architecture, designs the
database, generates hardened backend and frontend code, and keeps regenerating
incrementally as the requirements evolve.

**Status: Phase 5 — Backend Generation Engine.** Requirement analysis, architecture
planning, database design, and backend generation are live end to end; see the
roadmap below for what's next.

---

## Stack

| Layer   | Technology                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Client  | React 19 · Vite · TypeScript · TailwindCSS 4 · React Router · TanStack Query · Zustand · React Hook Form · Zod · Axios · Framer Motion |
| Server  | Node.js 22 · Express 5 · TypeScript · Prisma · MySQL · Helmet · CORS · express-rate-limit · express-validator · Morgan · Winston · Zod |
| Tooling | npm workspaces · ESLint (typed, flat config) · Prettier · Husky + lint-staged · GitHub Actions · Docker + Compose                      |

## Getting started

Requirements: Node ≥ 22, npm ≥ 10, Docker (for MySQL).

```bash
npm install                              # installs both workspaces + git hooks
cp server/.env.example server/.env       # defaults work with the dev database
npm run docker:dev                       # start MySQL 8.4 in Docker
npm run db:push                          # sync the Prisma schema
npm run dev                              # API on :4000, console on :5173
```

Open http://localhost:5173. The console proxies `/api` to the server, and the top bar
shows live API health. The API stays up in degraded mode if MySQL isn't running yet.

### Everyday commands

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | Run server + client concurrently                   |
| `npm run build`      | Production builds of both workspaces               |
| `npm test`           | Analyzer + planner test suites (Node test runner)  |
| `npm run lint`       | Typed ESLint across both workspaces                |
| `npm run typecheck`  | Strict TypeScript checks                           |
| `npm run format`     | Prettier over the whole repo                       |
| `npm run db:migrate` | Create/apply a Prisma migration                    |
| `npm run db:studio`  | Prisma Studio against the dev database             |
| `npm run docker:up`  | Full production-shaped stack (MySQL + API + nginx) |

## Architecture

Two npm workspaces, both **feature-first** — code is grouped by what it does for the
product, not by what kind of file it is.

```
server/src/
  modules/            # one folder per domain capability, mounted by the module loader
    health/           # implemented: liveness, readiness, dependency diagnostics
    analysis/           # implemented: NL requirement analysis → structured spec
    architecture/       # implemented: requirement spec → Software Design Spec
    database-designer/  # implemented: SDS → schemas, ER, OpenAPI, validation
    backend-generator/  # implemented: SDS + design → generated Express/Prisma backend
    auth/               # scaffold: JWT sessions, role guards
    generation/         # scaffold: prompt intake, pipeline orchestration
    security/           # scaffold: hardening of generated output
    review/             # scaffold: static analysis + optimization
  shared/             # config, logger, middleware, database client, types, utils
  app.ts              # middleware pipeline + module mounting (no socket, no DB)
  index.ts            # process lifecycle: boot, listen, graceful shutdown

client/src/
  features/           # dashboard, prompt (forge), architecture, database, backend, ...
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

All routes live under `/api/v1`. Phase 1 surface:

| Route                    | Purpose                                                   |
| ------------------------ | --------------------------------------------------------- |
| `GET /health`            | Full diagnostic report (503 when degraded)                |
| `GET /health/live`       | Liveness probe                                            |
| `GET /health/ready`      | Readiness probe (checks MySQL)                            |
| `POST /analyze`          | Requirement analysis: prompt → structured spec            |
| `POST /architecture`     | Architecture planning: spec → SDS + Markdown              |
| `POST /database/design`  | Database design: SDS → schemas, ER, contracts             |
| `POST /openapi/generate` | OpenAPI 3.1 contract from the SDS + design                |
| `POST /backend/generate` | Backend generation: SDS + design → Express/Prisma project |
| `GET /<module>`          | Module manifest for each scaffolded module                |

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

## Roadmap

1. ~~Foundation — workspaces, security middleware, module system, design system~~
2. ~~Requirement Analyzer — prompt → structured spec~~
3. ~~Architecture Planner — spec → Software Design Specification~~
4. ~~Database Designer & API Contract Generator — SDS → schemas + OpenAPI~~
5. ~~Backend Generation Engine — SDS + design → Express/Prisma backend~~ ← here
6. Security Engine — JWT auth, RBAC, hardening of generated output
7. Frontend Generation Engine
8. Dependency Graph Engine — incremental regeneration
9. AI Orchestrator, Project Export
