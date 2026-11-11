# NexArch

AI-assisted full-stack application generation. Describe an application in plain
language — NexArch analyses the requirements, plans the architecture, designs the
database, generates backend and frontend code, hardens it, projects the whole
thing into a queryable graph, and then lets you edit, validate, repair and run the
result locally.

> **Generated code runs with your privileges and is not sandboxed.** Read
> [Security](#security) before previewing a generated project.

Depth lives in three documents:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — pipeline stages, agent
  orchestration, the provider abstraction, the context engine, the graph, the
  editing and job lifecycles, the persistence model, validation and repair.
- [`docs/SETUP.md`](docs/SETUP.md) — prerequisites, databases, every environment
  variable by name, every test command, common failures.
- [`docs/SECURITY.md`](docs/SECURITY.md) — the host-execution model, the
  single-user assumption, single-instance assumptions, exposure, safe usage.

---

## What it does

| Capability                  | Shape                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| One-call generation         | `POST /pipeline/runs` — a prompt becomes a runnable project through eight recorded stages.                                                  |
| Agent mesh review           | Agents on a dependency-ordered DAG produce planning artifacts, generation metadata, typed findings and runtime/integration/test validation. |
| Self-repair                 | Findings feed a bounded repair loop that only marks a finding fixed with validation evidence.                                               |
| Project editing             | Change an existing generated project from an instruction, optionally with a reference image, as a durable background job.                   |
| Knowledge Graph             | Every run projects its artifacts into a persisted graph that answers "what depends on this?" and "where does this requirement end up?"      |
| Persistent generated output | A run's whole file set is stored, so a finished project survives the process that made it.                                                  |
| Local preview               | One click installs and starts the generated project on free localhost ports, with logs and diagnostics.                                     |
| Builder Agent               | An orchestrator you can talk to: it carries a task to a running website by calling the platform's own systems as tools.                     |
| Provider-agnostic models    | Six provider adapters behind one interface, routed by task complexity from a configuration table.                                           |
| Context and cost control    | Graph-keyed context assembly, per-task token budgets, a content-addressed agent-result cache, per-run cost reporting.                       |
| Portable projects           | Export a project to a single secret-free JSON package; import creates a new project from one.                                               |
| Demo mode                   | A deterministic sample build that needs no model, no key and no external service.                                                           |

## Stack

| Layer   | Technology                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client  | React 19 · Vite 6 · TypeScript · TailwindCSS 4 · React Router · TanStack Query · Zustand · React Hook Form · Zod · Axios · Framer Motion · React Flow |
| Server  | Node.js 22 · Express 5 · TypeScript · Prisma 6 · PostgreSQL · Helmet · CORS · express-rate-limit · express-validator · Morgan · Winston · Zod         |
| Testing | `node:test` via `tsx` (server) · Vitest (client) · Playwright (end-to-end)                                                                            |
| Tooling | npm workspaces · ESLint (typed, flat config) · Prettier · Husky + lint-staged · GitHub Actions                                                        |

## Getting started

Node ≥ 22 (`.nvmrc` pins 22), npm ≥ 10.

```bash
npm install                              # both workspaces + git hooks
cp server/.env.example server/.env       # placeholders only; fill in what you need
npm run dev                              # API on :4000, console on :5173
```

Open <http://localhost:5173>. You land straight in the app with no sign-in, as a
single built-in local user. Describe an application and build it. The console
proxies `/api` to the server, so the browser stays on one origin.

Nothing is required to boot — no database, no key. What each one adds:

| You add                              | You get                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| nothing                              | The full pipeline in degraded form: deterministic generators, in-memory projects, graph and run log, all reset on restart. |
| `AI_API_KEY`                         | The model path for the AI stages instead of the rule-based fallback.                                                       |
| `DATABASE_URL` (PostgreSQL)          | Durable projects, run history, the graph, **stored generated output**, and project editing.                                |
| `NEXARCH_RUNNER_DATABASE_URL`        | A real MySQL database for each previewed generated app instead of degraded no-database mode.                               |
| `AUTH_DISABLED=false` + `JWT_SECRET` | Real accounts, with per-account isolation.                                                                                 |

Two things are genuinely unavailable without a `DATABASE_URL`: generated output
does not survive a restart, and **editing a project is refused** — the edit-job row
is what lets an edit outlive the request that asked for it. Full details and the
schema commands are in [`docs/SETUP.md`](docs/SETUP.md).

### Ports

| Port    | What                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------- |
| `5173`  | NexArch console (Vite dev server)                                                                                   |
| `4000`  | NexArch API                                                                                                         |
| `5432`  | PostgreSQL — **the platform's own database**                                                                        |
| `3307`  | MySQL for **generated** apps, as the dev compose file publishes it (container 3306) — `NEXARCH_RUNNER_DATABASE_URL` |
| `4001+` | A previewed project's generated **backend** (first free port from 4000)                                             |
| `5174+` | A previewed project's generated **frontend** (first free port from 5173)                                            |

Preview ports are scanned, not assumed: the backend prefers 4000 and the frontend
5173 so a generated dev proxy works unmodified when those are free, and the scanner
takes the first genuinely free port from there. So a preview never takes NexArch
down, and no preview outlives the NexArch process that started it.

**The two databases do different jobs.** NexArch's own data is PostgreSQL —
Prisma's datasource and migration lock are both `postgresql`, and `DATABASE_URL` is
regex-checked at boot for a `postgresql://` string. MySQL appears only as the
database the runner hands to _generated_ applications, because generated backends
are MySQL-shaped. Two module headers still describe the platform's own store as
MySQL (`pipeline/lib/run-store.ts`, `workspace/lib/project-store.ts`); they are
stale comments, not behaviour. See the troubleshooting section of
[`docs/SETUP.md`](docs/SETUP.md).

### Everyday commands

| Command                              | What it does                                      |
| ------------------------------------ | ------------------------------------------------- |
| `npm run dev`                        | Server + client concurrently                      |
| `npm run build`                      | Production builds of both workspaces              |
| `npm run lint` / `npm run typecheck` | Typed ESLint / strict TypeScript, both workspaces |
| `npm run format`                     | Prettier over the repo                            |
| `npm run db:migrate`                 | Create and apply a Prisma migration               |
| `npm run db:studio`                  | Prisma Studio against the dev database            |

`npm run db:deploy` exists in the **server** workspace only — run it as
`npm run db:deploy --workspace server`.

## The generation workflow

`POST /api/v1/pipeline/runs` composes every stage behind a single prompt. The run
is detached from the request: the response is the run in `running` with every stage
`pending`, and the client polls — a multi-minute build does not belong behind an
HTTP timeout.

```
analysis → architecture → database → backend → frontend → security
         → dependencies → graph
```

The first two stages call a model; the rest are deterministic. Each stage records
its real status, duration, a one-line summary, and whether it fell back to
deterministic output. There is no synthetic percentage in the run object anywhere:
the client renders stage state because that is the only progress the server
measures.

Without a model key the pipeline still runs end to end. The AI stages fall back to
the built-in rule-based analyser and report themselves as **degraded** rather than
failing — a downgrade, stated, not an outage.

Every generated project is a website first: `/` is a public landing page written
for the request (validated field by field; without a model the copy is derived from
the spec and invents no prices or customers), with the working application behind
it at `/dashboard`. Generated apps are public MVPs by default — no login pages, no
guarded routes. `GENERATED_APP_AUTH=true` plans sign-in back into them.

## Editing an existing project

The hard part of "AI edits your app" is not changing something; it is not changing
everything else. Asked to change the hero, a regenerating editor quietly replaces
the menu, the navigation and the working routes.

So nothing in the editor regenerates from the prompt. The edit is expressed as a
new site design — the same validated object a build produces — and then the
_existing_ generators re-run over the _existing_ architecture, database design and
API contract. Those generators are deterministic, so every file whose inputs did
not change comes out byte-identical and the files that differ are exactly the ones
the edit touched. The diff is not a claim about what changed; it is what changed.

Three rules shape the rest:

- A plan is produced before anything is applied, and names the files it expects to
  change. The result names the files that actually changed.
- The edited application is really built, typechecked, linted and started before
  the edit is accepted. If it does not come up, the edit is discarded and the
  project keeps the files it had — nothing was written until it passed, so there is
  nothing to roll back.
- Impact comes from the Knowledge Graph's own edges. When the graph has nothing for
  a file, the plan says so rather than inventing a dependency.

### Image-assisted editing

An edit may carry a reference image — a screenshot, a mockup, an asset. A vision
model reads it and the reading feeds the new design; the model id is separate
(`AI_MODEL_VISION`) because routing an image to a text model would send the
instruction and silently drop the picture, and an adapter that cannot carry images
says so instead of degrading.

The image is untrusted input and is checked as such: the claimed content type is
ignored and the magic number read instead (PNG, JPEG, WebP), the size limit is
enforced on the decoded bytes, and the dimensions come from the format's own
header. Nothing interprets the image's _content_ — the reading prompt treats it as
a thing to describe, never as an instruction.

### Background edit jobs

Applying an edit is minutes of real work, and it used to run inside one HTTP
request. That made the client's timeout a race the user could lose: the request
failed while the server went on applying the edit, so the next edit started from a
project the user believed unchanged. Closing the tab did the same.

Now the work outlives the request and an `edit_jobs` row is what the client polls.
Stages are real steps with their own timestamps — `queued → rebuilding →
validating → deciding → finished` — so elapsed time is measured rather than
animated. Four terminal states, and the distinctions are deliberate:

- `SUCCEEDED` — applied.
- `REJECTED` — the edit ran and was refused; the project kept its previous files.
- `FAILED` — the attempt itself broke.
- `INTERRUPTED` — the process died mid-job; nothing can be assumed about how far it
  got. The boot sweep sets this, because "succeeded" and "failed" would both
  mislead.

One active edit per project, enforced by a partial unique index rather than by a
check-then-create the second click wins. Reloading the page or opening a second tab
picks up the edit already in progress instead of starting another.

## The Knowledge Graph

Every run projects its artifacts into a persisted graph of 15 node types and 13
relationship types (enumerated in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).
It answers what depends on what — impact analysis for incremental regeneration —
and validates its own consistency (`GET /projects/:id/graph/validate`: no orphan
edges, no dangling references).

Synchronization is a diff, not a rebuild, so node ids survive a re-run and a
transient builder failure leaves a slightly stale graph rather than none. Nodes are
addressed by a stable canonical name rather than a database id, so a re-imported
project's graph is self-consistent.

### Requirement tracing

A requirement is named several times before anyone reads it: the analyser writes
it, the graph stores it as a `REQUIREMENT` node, a finding points back at it. All
three agree because they share one canonicalization — the graph's own, re-exported
rather than reimplemented, since a second scheme would produce ids matching nothing
in the graph.

So the question the graph exists to answer is answerable: _this requirement — where
does it end up in the code?_ The server walks stored edges
(`/graph/nodes/:id/path?to=`) and the console's **Trace to…** renders the hops from
the nodes the server returned. Nothing invents a route or a file, and "there is no
path between these" is shown as the real finding it is rather than hidden as an
empty state.

## Persistent generated output

A run's output is stored. Until the `run_artifacts` table existed, generated code
lived only in a map inside the API process: the run row recorded that a build
happened while the build itself evaporated on the next restart, so a project showed
a completed run whose Code tab, Preview and editor had nothing to read — and the
graph, persisted all along, described a file tree that existed nowhere.

`loadArtifacts` now reads memory first and falls back to the table, caching what it
read. A restart no longer loses a finished project.

The real limits, which are worth knowing:

- **Retention is the newest 10 bundles per project.** Each bundle is a whole
  generated project, so an unbounded table would grow by roughly a megabyte per
  build forever. Pruning happens after the write, so a failed prune still leaves
  the newest output in place.
- **No `DATABASE_URL` means no storage at all** — the module is a no-op that says
  so rather than pretending to persist.
- **A failed write never fails a run.** Losing the durable copy is bad; throwing
  away a generated project because a database was briefly unreachable is worse. The
  store reports whether it stored, so callers can say so.

Live, high-churn state is still process-local by design: pipeline stage state,
agent runs, findings, repair sessions, validation results, caches, edit plans,
builder sessions and runner sessions. All of it is cheap to recompute or
meaningless outside the process that holds it.

## Model and provider configuration

Six adapters sit behind one `ModelProvider` interface: `groq`, `claude`, `openai`,
`gemini`, `openrouter`, `mock`. Adding one is a registry entry, never a call-site
change.

Which model does which work is a configuration table keyed by task complexity, not
a per-provider branch. Five complexities are routed: simple extraction, large
planning, small-file regeneration, complex refactor, and vision analysis.

```
AI_PROVIDER=groq
AI_API_KEY=…
```

`AI_MODEL_FAST`, `AI_MODEL_DEEP` and `AI_MODEL_VISION` override the models per
tier, and `AI_MODEL_<PROVIDER>_<TIER>` overrides one provider's tier;
`AI_PROVIDER_DEEP` and `AI_PROVIDER_RESEARCH` choose where planning and research
start; `AI_PROVIDER_CHAIN` sets the failover order, and `AI_FALLBACK_PROVIDER`
names the single provider tried when no chain is set. Each provider has its own
key (`GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`); `AI_API_KEY` is read only for Groq.
Overrides are read at call time, so a `.env` edit takes effect without a code
change.

Architecture and design prompts always use the deep route, classification stays on
the fast one, and a repair moves to the deep route once it has been asked for twice
in a job. One call makes at most 6 provider attempts (9 for deep work) across
retries and failover. A job stops with a named error at `AI_JOB_TOKEN_CEILING`
(default 1,500,000) or `AI_JOB_CALL_CEILING` (default 150).

Each answered provider call in a run or edit job with a project is saved per job.
Tokens or cost a provider did not report, or a model with no confirmed published
price, are stored as unknown and never as zero.

The key is read **server-side only** — it never appears in an API response, the
client bundle, or a browser request. An unconfigured provider resolves to the
fallback and then to `mock`, so a call is always servable and the stage that
degraded reports it. Under `NODE_ENV=test` the router pins to `mock` whatever the
environment says, so a real key in `.env` cannot turn the test suite into billed,
flaky calls.

Cost is controlled on three axes: per-task **token budgets** fitted to the
provider's ceiling, **graph-version-keyed context assembly** so an agent sees only
the artifacts relevant to its task (sanitized before the model), and a
**content-addressed agent-result cache** so a re-run pays only for what changed.
Every run reports its calls, tokens and estimated cost.

## Local preview

`POST /api/v1/runner/sessions` materializes a generated project on disk and runs
it: `preparing → installing → configuring → starting → running`, with
`stopping`/`stopped`/`restarting`/`failed` reachable from the obvious places. Every
failure funnels through one path that attaches human diagnostics from the log tail,
so a session dies with an explanation and the platform process never dies with it.

Concurrency is two separate limits — in-flight runs per owner
(`NEXARCH_RUNNER_MAX_SESSIONS`, default 2) and machine-wide across every owner
(`NEXARCH_RUNNER_MAX_ACTIVE_TOTAL`) — because the platform's own validation mesh
holds sessions too, and counting those against a user's budget refused that user a
preview while telling them to stop a session their list did not show.

**This is the unsandboxed part.** See [Security](#security).

## The Builder Agent

**Agent** in the sidebar (`/agent`) is the orchestrator you can talk to. Give it a
task — _"a landing page for a company called NovaStack with pricing, testimonials
and an FAQ"_ — and it carries that task to a running website by calling the
platform's own systems as tools, never by writing code itself:

| Tool                       | Delegates to                                                 |
| -------------------------- | ------------------------------------------------------------ |
| `create_project`           | the workspace                                                |
| `build_app`                | the generation pipeline                                      |
| `review_app`               | the agent mesh (review, build, start, integration, tests)    |
| `repair_app`               | the self-repair engine                                       |
| `preview_app`              | the local runner (install, database, start, health)          |
| `inspect_website`          | HTTP checks against the running site, as a visitor would     |
| `list_files` / `read_file` | the generated artifacts, read-only                           |
| `finish`                   | ends the session with its own account of what it established |

Each turn the model returns one validated JSON decision of one to three actions;
independent actions run in parallel and dependent ones are ordered by the loop
whatever the decision said. With no key configured, or an unusable answer, a
deterministic policy takes the step — and every decision is labelled **AI** or
**Policy**.

The agent cannot declare success without evidence: a session is _succeeded_ only
when the site was built, started and inspected. Tool arguments are
schema-validated, project/run/preview ids come from the session's own state rather
than from model arguments, and `inspect_website` fetches only the URLs the runner
reported. One session per owner at a time, because a session installs and starts a
whole application.

## Agent mesh and self-repair

A build can also be run by a **mesh of agents** on a dependency-ordered DAG.
Agents are declarations — inputs, outputs, dependencies, timeout, retry policy, and
the node types they may mutate — which the scheduler reads, so adding an agent
never means editing the scheduler.

| Mesh         | Agents                                                                                        | Produces                                                                   |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Planning     | requirement-analyst, product-architect, architecture-agent, database-architect, api-architect | requirement spec, product spec, architecture plan, DB design, API contract |
| Generation   | backend-engineer, frontend-engineer, ux-ui-engineer                                           | backend + frontend metadata, generation manifest, UX review                |
| Review       | security-engineer, dependency-engineer, code-quality-engineer                                 | findings (typed, with severity and evidence)                               |
| Runtime/test | runtime-engineer, integration-engineer, test-engineer                                         | build/startup/health/integration/test validation                           |

Writes are serialized because the artifact store and graph sync are
read-modify-write; the review mesh is the one concurrent wave, and it earns that
from its own `mutates: []` declaration rather than from an assumption.

Validation ends in a gate that is a decision procedure, not a score: seven rules
checked in order, first match wins, and the summary carries the sentence that
produced the verdict (`PASSED`, `PASSED_WITH_WARNINGS`, `BLOCKED`, `FAILED`).
Nothing in it claims "production ready" — a pass is a claim about these checks.

Findings feed a bounded **self-repair loop**: detect → understand → plan → patch →
validate → accept or roll back, decided from check outcomes only. Files live in
versioned artifacts, so the snapshot before a repair is the version that already
exists and a rollback writes the prior content forward as another version — history
is never rewritten, even to undo. Five brakes each have their own stop state
(attempt limit, repair budget, wall-clock/token budget, fixed-then-regressed loop
detection, and mandatory rollback on regression). A finding is marked fixed only
with validation evidence.

## Demo mode and portable projects

**Demo mode** builds a fixed sample from the platform's own deterministic
generators, so it needs no model, no key and no external service, and produces the
same result every time. It carries a synthetic review — findings, one repaired, a
passing-with-warnings validation — so it tells the whole generate → review → repair
→ validate story. It is labelled **Demo** everywhere and rebuilds in place when
started again.

**Export** writes any project to a single self-describing JSON package: metadata,
latest specification artifacts, graph, findings, validation summary and repair
history — its state, never its secrets. Every value is walked through the same
redactor that guards the logs before it becomes a file.

**Import** creates a _new_ project from a package and never overwrites one. It is
the adversarial direction and is treated that way: the schema version is checked,
the size bounded, artifact paths rejected if they traverse or absolute-escape,
graph edges validated, and nothing is ever executed. A hostile package is rejected
with a reason rather than partially applied.

## Architecture

Two npm workspaces, both feature-first — code is grouped by what it does for the
product, not by what kind of file it is.

```
server/src/
  modules/               # one folder per capability, mounted by the module registry
    health/              # liveness, readiness, dependency diagnostics
    auth/                # local accounts, JWT httpOnly-cookie sessions, role guards
    analysis/            # NL requirement analysis → structured spec
    architecture/        # requirement spec → architecture plan
    database-designer/   # plan → schemas, ER, OpenAPI, validation
    backend-generator/   # plan + design → generated Express/Prisma backend
    frontend-generator/  # plan + design → generated React/Vite frontend
    security-engine/     # hardening + security analysis of the output
    dependency-graph/    # change impact analysis, incremental regeneration
    agent-orchestrator/  # the agent mesh: DAG scheduler, artifact/finding/repair
                         #   stores, self-repair loop, validation mesh, result cache
    engineering-graph/   # the Knowledge Graph (nodes/edges) + validation + traversal
    context-engine/      # graph-keyed context assembly, token budgets, sanitizer
    ai-orchestrator/     # provider adapters, model routing, retries, workflows
    pipeline/            # one-call prompt → … → graph, plus run + artifact stores
    project-editor/      # instruction/image edits, plans, durable edit jobs
    builder-agent/       # the talk-to-it orchestrator and its tools
    runner/              # local runs: ports, logs, diagnostics, orphan reaping
    workspace/           # projects, generation history, export/import, demo
    deployment/          # deployment-infrastructure generation (credential-gated)
    quality/ · insights/ # quality scoring, test/doc generation; architecture insights
    review/              # scaffold: static analysis + optimization (not wired)
  shared/                # config, contracts, logger, middleware, database client,
                         #   security, identity, types, utils
  app.ts                 # middleware pipeline + module mounting (no socket, no DB)
  index.ts               # boot, reconciliation sweeps, listen, graceful shutdown

client/src/
  features/
    home/ · auth/ · projects/     # landing + onboarding, login/guard, project list
    workspace/                    # per-project tabs (overview, requirements, build,
                                  #   architecture, database, code, preview,
                                  #   intelligence, edit) + the Knowledge Graph view
    agent/                        # the Builder Agent console
    preview/ · pipeline/ · prompt/
    architecture/ · database/ · backend/ · frontend/ · security/ · dependency-graph/
    search/ · settings/ · notifications/
  shared/                         # design system, layouts, hooks, services, stores, lib
  app/                            # router, legacy redirects, error + 404
```

Four rules the codebase keeps by convention:

- **Modules are islands.** A server module owns its URL subtree and internals;
  modules share code only through `shared/`. Adding a feature is a folder plus one
  line in the registry.
- **One error pathway.** Everything throws `AppError`, or is normalized into one,
  and a single handler turns it into a stable JSON envelope. Every response carries
  an `X-Request-Id` that appears in the server logs.
- **Config is validated at boot.** `process.env` is read through a Zod schema and a
  misconfigured server refuses to start. (The AI and runner variables are the
  documented exception: they are read where used, so a bad value degrades a feature
  instead of stopping the boot.)
- **The client never sees axios or envelopes.** Features consume typed hooks; the
  HTTP layer unwraps envelopes and normalizes failures once.

### API

All routes live under `/api/v1`. Every route requires an authenticated session
except the public ones noted; in the default no-auth mode that session is the
built-in local user. A resource that is not yours returns `404`, never another
user's data and never a confirmation that the id exists.

| Group                | Auth   | Key routes                                                                                                                                                                                                                                                              |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health`             | public | `GET /health`, `/health/live`, `/health/ready`                                                                                                                                                                                                                          |
| `auth`               | public | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/refresh`                                                                                                                                                                                                   |
| `auth`               | authed | `GET /auth/me`, `POST /auth/onboarding/complete`                                                                                                                                                                                                                        |
| `workspace`          | authed | projects `GET·POST·PATCH·DELETE`, `POST /project/:id/duplicate`, `GET /project/:id/export`, `POST /projects/import`, `POST /demo`, `GET /project/:id/runs`, `/history`, `/statistics`                                                                                   |
| `pipeline`           | authed | `POST /pipeline/runs`, `GET /pipeline/runs[/:id[/artifacts[/manifest·/:type]]]`, `POST /pipeline/runs/:id/retry`                                                                                                                                                        |
| `agent-orchestrator` | authed | `POST /projects/:id/agent-runs`, `GET …/agent-runs[/agents·/:runId[/tasks·events·artifacts]]`, `POST …/:runId/cancel·resume`, `GET·PATCH /projects/:id/findings[/:id]`, `/engineering-review`, `/validation`, `/intelligence/summary`, `POST·GET /projects/:id/repairs` |
| `engineering-graph`  | authed | `GET /projects/:id/graph`, `/graph/validate`, `/graph/nodes/:id[/dependencies·dependents·path]`, `/graph/impact/:id`, `POST /graph/refresh`                                                                                                                             |
| `project-editor`     | authed | `POST /projects/:id/edits/plan`, `GET …/edits/:planId`, `POST …/edits/:planId/apply`, `GET …/edits/jobs/current`, `…/edits/jobs/:jobId`                                                                                                                                 |
| `context-engine`     | authed | `POST /projects/:id/context`, `/context/trace`, `/context/benchmark`, `GET /context/stats`                                                                                                                                                                              |
| `runner`             | authed | `POST /runner/plan`, `/runner/sessions`, `GET /runner/sessions[/:id[/logs]]`, `POST /runner/sessions/:id/stop·restart`                                                                                                                                                  |
| `builder-agent`      | authed | `POST /builder/sessions`, `GET /builder/sessions[/:id]`, `POST /builder/sessions/:id/cancel`                                                                                                                                                                            |
| generators           | authed | `analyze`, `architecture`, `database`, `openapi`, `backend`, `frontend`, `security`, `dependency`, `ai`, `insights`, `deployment`, `quality`/`testing`/`documentation`/`performance`/`release`, `review` (scaffold)                                                     |

Success and failure envelope shapes are defined in
`server/src/shared/types/api.ts` and mirrored on the client.

## Tests

Root scripts fan out to both workspaces; the exact per-workspace commands matter,
because the three `package.json` files do not define the same scripts.

```bash
npm run typecheck                               # tsc, both workspaces
npm run lint                                    # typed eslint, both workspaces
npm test                                        # server (node:test) + client (vitest)
npm test --workspace server                     # the server unit suite alone
npm run test:integration --workspace server     # needs a live database
npm test --workspace client                     # vitest run
npm run build                                   # production build, both workspaces
```

The server unit suite is an **explicit list of 35 files** held in the
`config.testFiles` key of `server/package.json`, not a glob: npm exports `config`
keys as `$npm_package_config_*`, so `test` and `test:coverage` read one list and
cannot drift apart, and `*.integration.test.ts` stays out of it because it needs a
live database. Adding a unit test file means adding it to that key.

`test:integration` runs four named files against whatever `DATABASE_URL` points at
and will not pass without one.

The end-to-end suite (`e2e/`, Playwright) drives the real stack — nothing is
mocked, and the preview flow runs a real `npm install`. There is no `webServer`
block, so the stack must already be running; otherwise every spec skips with the
command that would make it runnable.

CI (`.github/workflows/ci.yml`) runs `format:check`, lint, typecheck, test and
build on every push and PR to `main`, audits dependencies advisorily, typechecks
and lists the E2E specs without executing them, and builds both Docker images to
confirm they stay buildable.

## Security

- **Authentication is off by default** (`AUTH_DISABLED=true`): every request runs
  as one built-in local user with the `ADMIN` role and no login, for
  zero-friction local use. That mode answers only requests from the same machine,
  and the server refuses to start with it under `NODE_ENV=production`, so the
  compose stack always has accounts on and needs a `JWT_SECRET`. Turning accounts
  on (`AUTH_DISABLED=false` plus a real
  `JWT_SECRET`; the boot refuses otherwise) restores real accounts — bcrypt
  hashing, a short access token and a longer refresh token in
  httpOnly/SameSite/Secure-in-prod cookies, never readable by page script.
- **Authorization and isolation** are in place in both modes: every data and
  compute route resolves its resource through the caller's id first, so another
  user's project, run, session, finding, edit or export reads as `404`. In no-auth
  mode there is one owner; with accounts on, the same code isolates per account.
- **Secret handling** — the model key is server-side only; one redactor guards logs
  and the export package, a sanitizer scrubs context before every model call, and
  generated child processes get a whitelisted environment rather than NexArch's.
- **Path and command safety** — the runner writes only inside its run workspace
  (traversal and absolute paths rejected, by path and by realpath), every spawn is
  an explicit executable plus argv with `shell: false`, and import validates every
  package path the same way and executes nothing.
- **Rate limiting** — a global per-IP window, a separate budget for polled reads so
  a running preview cannot starve the API, and a tighter per-user limit on expensive
  operations.

### What this does not protect against

**Generated projects are not sandboxed.** Previewing one runs `npm install` and
then the project's own dev servers as your user account, with your filesystem, your
network and your environment. A generated `postinstall`, a dependency's install
script, or the application code itself can do anything you can do. The containment
described above is about where NexArch _writes_ files, not about what generated
code may do once it runs.

**No OS-level sandbox is in place and none has been verified here.** Docker is not
installed on this machine, and macOS `sandbox-exec` is deprecated and unverified,
so neither is claimed. The repository's compose files build and run NexArch itself;
they are not an isolation boundary around generated code.

So NexArch is safe to run on code you are willing to execute locally — your own
prompts, your own machine. It is **not** safe to expose to arbitrary untrusted
users, and turning authentication on does not change that: an account that can
submit a prompt can get code executed on the host. This is not enterprise-ready and
it is not secure multi-tenant execution. Real multi-tenant use needs OS-level
isolation per run (a container or VM with no host mount, its own network namespace
and a CPU/memory cap), which is not implemented.

[`docs/SECURITY.md`](docs/SECURITY.md) covers the rest.

## Known limitations

- **No sandbox for generated code** (above). This is the governing limitation.
- **The boot-time reconciliation sweeps assume a single server instance.** Both are
  unscoped `updateMany` statements with no instance id or lease, so a second
  instance starting beside a live one would mark the live one's in-flight build
  failed and its in-flight edit interrupted. Run one instance per database; scaling
  horizontally needs per-instance job ownership first.
- **Edit history is bounded.** Finished `edit_jobs` rows older than
  `EDIT_JOB_RETENTION_DAYS` (default 30) are deleted in one bounded batch per boot.
  Live jobs are never candidates, and every project keeps its newest finished job
  whatever its age — but older edit history does go.
- **Generated output is retained for the newest 10 runs per project**, and not at
  all without a `DATABASE_URL`.
- **Editing requires a `DATABASE_URL`** and is refused without one.
- **`review` is an intentional scaffold.** Its routes answer as a scaffold; no
  static-analysis or optimization pass is wired behind them.
- **Deploy providers ship disabled** until their token is set. Planning and status
  endpoints work with no secrets; the execution step does not run without one.
- **Repository hosting is out of scope.** Local files, localhost and the API are the
  source of truth.

## Deployment

`docker-compose.yml` describes the production shape: PostgreSQL 16, the API as a
multi-stage non-root healthchecked Node image, and the console as a static build
behind nginx, which proxies `/api` so the browser stays on one origin and CORS
never applies in production.

```bash
cp .env.example .env    # set POSTGRES_PASSWORD, JWT_SECRET, or point DATABASE_URL elsewhere
npm run docker:up
```

Console on <http://localhost:8080>, API health at
<http://localhost:4000/api/v1/health>. This needs Docker installed, and it is the
platform's own deployment setup — it is not isolation for generated code.
Publishing images and deploying is left to whichever hosting target you pick.

Separately, the `deployment` module (`POST /api/v1/deployment/generate`) generates
deployment infrastructure — Dockerfiles, CI/CD pipelines, env templates — for the
applications NexArch generates, across 12 targets: Docker, Docker Compose, Vercel,
Netlify, Render, Railway, AWS EC2, AWS ECS, GCP Cloud Run, Azure App Service,
DigitalOcean and local.

## What's next

[`docs/v2/NEXARCH_V2_ARCHITECTURE.md`](docs/v2/NEXARCH_V2_ARCHITECTURE.md) is a
design document for a further step: a deliberating multi-agent organization with
governance, voting, long-term decision memory and a learning loop. The agent mesh
described above is implemented; the coordination layer that document proposes — the
message bus, the voting protocol, the cross-project memory — is not.

---

Made by [Ashutosh Sharma](https://www.linkedin.com/in/ashutoshsharma1309/)
