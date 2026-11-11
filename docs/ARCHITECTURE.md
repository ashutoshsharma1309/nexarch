# NexArch architecture

How the implemented system is put together. Everything here is described from the
code; where a capability is declared but not wired, it says so.

Two npm workspaces, `server` and `client`. The server is a modular Express 5
application: `app.ts` assembles the middleware pipeline and mounts feature
modules, `index.ts` owns the process lifecycle. No sockets, no database access
and no module state live in `app.ts`, which is why the app can be exercised
without a listener.

Middleware order, from `server/src/app.ts`:

```
requestContext → security (helmet/CORS) → compression → cookies → body parsers
  → requestLogger → global rate limit → polling rate limit → modules → 404 → errors
```

`requestContext` is first and nothing may be mounted ahead of it: it opens the
AsyncLocalStorage context the logger reads correlation ids from, so anything
running earlier logs with no request id.

Modules are mounted from one registry (`server/src/modules/index.ts`) under
`/api/v1`. Each owns a disjoint URL subtree, so mount order is irrelevant. Adding
a capability is a folder plus one line in that array.

---

## The generation pipeline

`POST /api/v1/pipeline/runs` is one prompt in, a runnable project out. The run is
detached from the request: the response is the run in `running` with every stage
`pending`, and the client polls. Eight stages, in this order
(`STAGE_TEMPLATE` in `server/src/modules/pipeline/pipeline.service.ts`):

| #   | Stage          | Label                 | Engine        |
| --- | -------------- | --------------------- | ------------- |
| 1   | `analysis`     | Requirement Analysis  | AI            |
| 2   | `architecture` | Architecture Planning | AI            |
| 3   | `database`     | Database Design       | deterministic |
| 4   | `backend`      | Backend Generation    | deterministic |
| 5   | `frontend`     | Frontend Generation   | deterministic |
| 6   | `security`     | Security Hardening    | deterministic |
| 7   | `dependencies` | Dependency Graph      | deterministic |
| 8   | `graph`        | Engineering Graph     | deterministic |

Each stage consumes the previous stage's structured output, and each records its
own status, start, end, duration, one-line summary and whether it fell back to
deterministic output (`degraded`). There is no synthetic percentage anywhere in
the run object: a client renders stage state because that is the only progress
the server actually measures.

Every stage declares an `agentId` as well. It carries no behaviour — it is the
migration seam for replacing a stage's function call with the corresponding
agent, and nothing dispatches on it today.

A run always belongs to a project. A caller may name one; a caller that does not
gets a project derived from the prompt, created on the spot.

The output bundle (`PipelineArtifacts`) holds the requirement spec, the
architecture plan and its markdown, the design bundle, the generated backend and
frontend, the security bundle, the dependency bundle, the site design, and the
final overlaid file set. It is fetched separately from the run — it is far too
large to poll.

---

## Agent orchestration

Three modules sit at different levels, and the distinction matters.

**`ai-orchestrator`** is the lowest: it turns one request for model work into one
provider call. Prompt templates, routing by task complexity, retries, response
validation, token estimation, cost estimation and caching live here. It knows
nothing about projects or runs.

**`agent-orchestrator`** is the agent mesh. It plans a DAG of agent tasks for a
project, schedules it, stores typed artifacts and findings, runs validation, and
drives the self-repair loop. Agents reach models through `ai-orchestrator`;
nothing in the mesh calls a provider directly.

**`builder-agent`** is the top: an orchestrator you can talk to. It never writes
code. It calls the platform's own systems as tools, including both of the layers
above.

So the call direction is one way: `builder-agent` → (`pipeline`,
`agent-orchestrator`, `runner`, `workspace`) → `ai-orchestrator` → provider.

### The mesh

Agents are declarations, not code paths: `server/src/shared/contracts/agent-registry.ts`
holds each agent's id, required inputs, produced artifacts, dependencies, context
type, execution mode, timeout, retry policy and the node types it may mutate.
The scheduler reads those declarations, which is why adding an agent never means
editing the scheduler.

Sixteen agents are declared. Fourteen are enabled and form a generation run's DAG:

| Mesh         | Agents                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------- |
| Planning     | requirement-analyst, product-architect, architecture-agent, database-architect, api-architect |
| Generation   | backend-engineer, frontend-engineer, ux-ui-engineer                                           |
| Review       | security-engineer, dependency-engineer, code-quality-engineer                                 |
| Runtime/test | runtime-engineer, integration-engineer, test-engineer                                         |

Two are declared with `enabled: false` and are deliberately not part of a run's
DAG: `repair-engineer`, which the repair engine invokes per finding through the
same executor, and `dependency-analyst`, whose work is currently the pipeline's
dependency stage.

### The scheduler

The loop finds tasks whose dependencies are satisfied _and_ whose input artifacts
exist, runs them, records what happened, and repeats. The two refusals are the
design:

- **Writes are serialized.** The artifact store and the graph sync are
  read-modify-write with no transaction around them, so agents that produce or
  revise artifacts run one at a time. The single exception is earned from the
  declarations rather than assumed: a wave whose agents all declare `mutates: []`
  and revise nothing — the review mesh — runs concurrently and commits serially.
- **A task whose inputs are missing does not start.** Satisfaction is checked at
  the artifact level, not the task level, so a completed upstream task that
  produced nothing usable leaves its dependents `BLOCKED` rather than letting
  them run on absent input.

Agent results are cached content-addressed on inputs, prompt version and model
signature, so a re-run pays only for what changed.

### The Builder Agent loop

Each turn the model returns one validated JSON decision of one to three actions.
Independent actions run in parallel; dependent ones are ordered by the loop
whatever the decision said. With no model configured, or an unusable answer, a
deterministic policy takes the step, and every decision is labelled `model` or
`policy` in the session.

Nine tools, each a validated front door to a system that already exists:
`create_project`, `build_app`, `review_app`, `repair_app`, `preview_app`,
`inspect_website`, `list_files`, `read_file`, `finish`.

The trust boundaries are explicit: tool arguments come from a model so every one
is schema-validated; identifiers that matter (project, run, preview) come from the
session's own state and never from arguments; `inspect_website` fetches only the
local URLs the runner handed back, so a model cannot point it elsewhere; and file
access is to generated artifacts in memory, never the filesystem. A session is
`succeeded` only when the site was built, started and inspected.

One session per owner at a time — a session installs and starts a whole
application, and two at once is what pushes a small machine into swap.

---

## The provider abstraction

`ModelProvider` is the only thing the router and orchestrator depend on. Adding a
provider is a registry entry (`lib/providers/provider-registry.ts`), never a call-site
change. Each adapter declares its id, default model, per-million input and output
cost, whether it is configured, and whether it can carry image parts.

Six adapters: `groq`, `claude`, `openai`, `gemini`, `openrouter`, `mock`.

Routing is a data table keyed by task complexity, not a per-provider branch
(`lib/model-router.ts`). Five complexities are routed: `simple-extraction`,
`large-planning`, `small-file-regen`, `complex-refactor`, `vision-analysis`.
`AI_PROVIDER`, `AI_MODEL_FAST`, `AI_MODEL_DEEP`, `AI_MODEL_VISION` and
`AI_FALLBACK_PROVIDER` override the table from the environment, read at call time
so a `.env` edit takes effect without a code change.

Two rules are worth knowing because they are load-bearing:

- `resolveProvider` falls back to the configured fallback provider and then to
  `mock`, so a call is always servable. A missing key is a downgrade, not an
  outage — and the stage that degraded says so, in the run.
- Under `NODE_ENV=test` the router pins to `mock` whatever the environment says,
  so a developer with a real key in `.env` cannot turn the test suite into
  billed, flaky, network-dependent calls.

Vision is a separate model id on purpose: routing an image to a text model would
send the instruction and silently drop the picture. An adapter that cannot carry
images reports so, and the caller refuses rather than degrading.

---

## The context engine

`context-engine` decides what a model should be told. It calls no model itself,
and the decision is deterministic so it can be reproduced, explained and tested.

The stages are resolve → select artifacts → compile → budget → sanitize, with a
cache in front and a trace out the back. Ownership is a precondition: the project
is resolved through the caller's id before any graph or artifact is touched.

The cache key includes a graph version derived from the project's node count, edge
count and newest node timestamp, so a cached context can never outlive the
artifacts it described. A graph sync invalidates every context compiled from the
old graph.

Two modes exist. `SELECTIVE` (the default) walks the graph from the task's focus
and includes only what is relevant. `FULL` is the control arm, bounded by the
default models' context window, and exists so the saving `SELECTIVE` claims is
measured against something real rather than asserted.

Budgets are per task type and are then fitted to the provider's own ceiling
(`AI_MAX_REQUEST_TOKENS`, default 32000); when the provider limit forces the
output allowance down, the fitted budget reports itself as clamped.

Sanitization runs last, before anything reaches a provider.

A project with no graph is a `404`, not an empty context — silently returning
nothing would let a caller send a model an empty brief and treat the answer as
real.

---

## The Engineering Graph

The project's structured knowledge: what was asked for, what was planned, what was
generated, and how it connects. Stored relationally in two tables rather than in a
graph database because the shape is small — hundreds of nodes per project, not
millions — and bounded traversal over two indexed tables beats operating a second
datastore.

Fifteen node types:

```
PROJECT · REQUIREMENT · FEATURE · COMPONENT · SERVICE · API · ENTITY · FIELD
FILE · FOLDER · MODULE · SECURITY_RULE · DEPENDENCY · TEST · FINDING
```

Thirteen relationship types:

```
CONTAINS · IMPLEMENTS · DEPENDS_ON · USES · CALLS · EXPOSES · PERSISTS
BELONGS_TO · GENERATES · VALIDATES · TESTS · SECURED_BY · TARGETS
```

Identity is `canonicalName`, unique per `(projectId, type, canonicalName)`, not a
database id — so two artifacts naming the same thing differently resolve to one
node, and a re-imported project's graph is self-consistent. Edges are unique per
`(source, target, relationship)`, which is what makes re-running the builder
idempotent.

Synchronization is a diff, not a rebuild. Deleting and re-inserting would change
node ids on every run and would leave a project with no graph at all after a
transient builder failure. What the diff may _delete_ is narrower than what it
reads, because two producers write this one graph: a caller holding only part of a
project (the agent mesh mid-run) declares which artifacts it speaks for, and the
sweep cannot remove the other producer's nodes.

Reads load a project's nodes and edges once and index them in memory, so one
request can answer several questions without re-querying. The traversals exposed
are dependencies, dependents, path-between, impact and a consistency validation
(no orphan edges, no dangling references).

**Requirement tracing** is this graph plus one stable id. `shared/identity/requirement-id.ts`
re-exports the graph's own canonicalization rather than inventing a second
scheme — a separate slug or hash would produce ids matching nothing in
`graph_nodes`, which is worse than no id at all. So the analyser, the
`REQUIREMENT` node and a finding pointing back at it all agree on which
requirement is which. `GET /projects/:id/graph/nodes/:nodeId/path?to=` walks the
stored edges, and the console's "Trace to…" renders that answer; when there is no
path it says so, because that is a real finding about a project rather than an
empty state to hide.

Without a `DATABASE_URL` the graph has an in-memory backend behind the same
interface, with node ids stable across runs within the process.

---

## The project-editing lifecycle

`project-editor` changes an existing generated project from an instruction and,
optionally, a reference image.

Nothing here regenerates from the prompt. The edit is expressed as a new
`SiteDesign` — the same validated object a build produces — and then the
_existing_ generators are re-run over the _existing_ architecture, database design
and API contract. Those generators are deterministic, so every file whose inputs
did not change comes out byte-identical and the files that differ are exactly the
ones the edit touched. The diff is not a claim about what changed; it is what
changed.

Plan, then apply:

1. **Plan** (`POST /projects/:projectId/edits/plan`) reads the project's newest
   completed run and its artifacts, optionally reads the attached image with the
   vision model, and produces a plan naming the files it expects to change plus
   the impact the Knowledge Graph's own edges report. When the graph has nothing
   for a file, the plan says so rather than inventing a dependency. Plans are
   short-lived in-memory state (bounded at 40), so a restart clears them and the
   edit is planned again.
2. **Apply** (`POST /projects/:projectId/edits/:planId/apply`) rebuilds the file
   set, diffs it against the current one, then really builds, typechecks, lints
   and starts the edited application through the runner before deciding. If it
   does not come up, the edit is discarded and the project keeps the files it
   had — there is nothing to roll back, because nothing was written until it
   passed. Each check carries the command that produced it and its exit code, so
   a failure can be read rather than merely believed.
3. **Accepted** edits are registered as the project's newest completed run via
   `registerEditedRun`, because Preview, Code, the Knowledge Graph and project
   history all read "the project's latest completed run". The stages on that run
   are supplied by the editor and describe what an edit actually did — reporting
   the eight generation stages it never ran would be invented evidence.

Storage comes first in `registerEditedRun`, and nothing is registered until it
succeeds: registering the run and then reporting that its files were not stored
left a `COMPLETED` row for an edit the user had been told was not applied, which
the next edit would baseline from.

Reference images are validated before anything else sees them
(`lib/image-input.ts`): the claimed content type is ignored and the magic number
read instead, the size limit is enforced on the decoded bytes (4 MiB), and the
dimensions are read from the format's own header (64–8000 px per edge). PNG, JPEG
and WebP. Nothing interprets the image's content — the reading prompt treats it as
a thing to describe, never as an instruction. The body limit is raised to 8 MB on
these two routes alone rather than loosened for the whole API.

---

## The background job lifecycle

Applying an edit is minutes of real work and used to run inside a single HTTP
request, which made the client's timeout a race the user could lose: the request
failed while the server went on applying the edit, so the next edit started from a
project the user believed unchanged. Closing the tab did the same.

So the work outlives the request and an `edit_jobs` row is what the client polls.
It is durable for one specific reason: a restart mid-edit must be reportable as an
interruption rather than silently forgotten or, worse, read as success.

Stages, each with its own start and end so elapsed time is measured rather than
animated:

```
queued → rebuilding → validating → deciding → finished
```

Six statuses, four of them terminal:

| Status        | Meaning                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `QUEUED`      | Created, not started.                                                                              |
| `RUNNING`     | In progress.                                                                                       |
| `SUCCEEDED`   | Terminal. The edit was applied.                                                                    |
| `REJECTED`    | Terminal. The edit ran and was refused — validation failed, the project kept its previous files.   |
| `FAILED`      | Terminal. The attempt itself broke.                                                                |
| `INTERRUPTED` | Terminal. The process died while the job was running; nothing can be assumed about how far it got. |

`REJECTED` and `FAILED` are deliberately distinct: a refused edit and a broken
attempt are different facts about a project.

One active job per project, enforced by a partial unique index on `(project_id)
WHERE status IN ('QUEUED','RUNNING')` — Prisma cannot express a partial index, so
it lives in migration `20261024150000_one_active_edit_per_project`. Uniqueness is
the database's, not the service's: checking first and creating second is a race a
double-click wins, and the loser would rebuild from the same baseline and have its
work silently discarded. A unique violation is reported as "an edit is already
running".

Edits require a `DATABASE_URL`. With no database the module refuses the edit
rather than starting work whose outcome has nowhere to go.

### Boot reconciliation

`server/src/index.ts` settles the last process's unfinished work before the socket
opens:

1. **Orphaned generated-app processes** are reaped. The supervisor sweeps its own
   children on `exit` and on SIGTERM/SIGINT/SIGHUP, which covers every shutdown it
   is told about but cannot cover SIGKILL. So every long-running child writes down
   its pid, cwd and command before it starts, and a fresh NexArch finishes the job.
   A note is acted on only when the pid is still alive _and_ the live process's
   command line still points into the recorded workspace, because pids are
   recycled and killing a stranger's process is worse than leaving a port bound.
2. **Old run workspaces** are pruned. Each carries its own installed
   `node_modules`, so leaving every one behind fills the disk and the next run's
   install pays for it.
3. **Interrupted runs** — `generations` rows in a non-terminal status — are marked
   `FAILED`. Until this existed, a restart during a build left a project showing
   "building" forever with nothing building.
4. **Interrupted edits** — `edit_jobs` rows in `QUEUED` or `RUNNING` — are marked
   `INTERRUPTED`.
5. **Finished edit jobs past the retention window** are deleted. This is
   maintenance rather than recovery, and it runs here because boot is the one
   moment with no edit of this instance's own in flight.

Steps 3 and 4 are unscoped `updateMany` statements: they settle _every_ non-terminal
row, not the rows this instance wrote. That makes them correct for exactly one
server instance and wrong for two — see [SECURITY.md](SECURITY.md).

The retention sweep (step 5) is bounded by construction rather than by care. It
selects only rows whose status is terminal and whose `completedAt` is older than
`EDIT_JOB_RETENTION_DAYS` (default 30), so a `QUEUED` or `RUNNING` row — including
the one the partial unique index protects — is never a candidate however stale it
looks. It excludes the newest finished job of every project in the batch whatever
its age, so "what was the last thing that happened to this project" survives any
window. It touches nothing but `edit_jobs` rows, and nothing in the schema
references that table. Deletes are by primary key, so a repeat deletes nothing
twice and a crash half way leaves the remainder for the next call. One bounded
batch per boot (500), oldest first, so a backlog drains over several boots in the
order it accumulated rather than delaying a start-up; a failure is logged and
ignored, because housekeeping must never stop a boot.

If the database is unreachable at boot, production refuses to start and
development continues in degraded mode with `/health` reporting it.

---

## Generated-app execution

`runner` materializes a generated project on disk and runs it. Phases:

```
preparing → installing → configuring → starting → running
```

with `stopping`, `stopped`, `restarting` and `failed` reachable from the obvious
places. The pipeline is detached from the request; every failure funnels through
one `fail()` that attaches human diagnostics from the log tail, so a session dies
with an explanation and the platform process never dies with it.

Ports are scanned, not assumed. The backend prefers 4000 and the frontend 5173 —
so a generated project's dev proxy works unmodified when those are free — and the
scanner takes the first free port from there, up to 200 candidates. "Free" means
nothing accepts a connection on either loopback and both loopbacks can be bound:
`SO_REUSEADDR` makes a bare 127.0.0.1 bind lie (this is how a generated backend
once landed on NexArch's own 4000), and an IPv4-only probe misses servers
listening only on `::1`. A port is reserved the moment it is handed out, with a
TTL, because detection is not allocation.

Generated backends are MySQL-shaped. When `NEXARCH_RUNNER_DATABASE_URL` names a
MySQL _server_ whose user can create databases, each run gets its own
`nexarch_run_<slug>` database; without it, generated backends start in degraded
mode with no database and the session says so.

Two different limits, kept separate on purpose: a per-owner cap on in-flight runs
(`NEXARCH_RUNNER_MAX_SESSIONS`, default 2) and a machine-wide cap across every
owner (`NEXARCH_RUNNER_MAX_ACTIVE_TOTAL`, default four times the per-owner cap).
They cannot be one budget: the validation mesh holds sessions under an internal
owner tag, so counting them against a user's budget refused that user a preview
and told them to stop a session their list did not show. A limit may only be
enforced over the set the caller can act on; anything wider needs its own message.
In-memory session records are additionally capped at 30, evicting terminal ones.

**There is no isolation boundary here.** See [SECURITY.md](SECURITY.md).

---

## The persistence model

Prisma against PostgreSQL. The datasource provider is `postgresql`, the migration
lock is `postgresql`, and `DATABASE_URL` is regex-checked for a `postgresql://`
(or `postgres://`) string at boot. MySQL appears in this platform only as the
database handed to _generated_ applications by the runner.

Eight tables, from `server/prisma/schema.prisma`:

| Table           | Holds                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `roles`         | Assignable authorization roles. A table rather than an enum so a role can gain metadata without a migration dance. |
| `users`         | Accounts: email, bcrypt hash (nullable — a null hash simply cannot log in), name, onboarding timestamp, role.      |
| `projects`      | One user-owned workspace per generated application: name, slug, description, status, favourite, owner.             |
| `generations`   | The run audit trail: prompt, status, error, timings. The durable record _that_ a run happened.                     |
| `run_artifacts` | What a run produced: the whole `PipelineArtifacts` bundle as JSON, plus denormalised file count and byte size.     |
| `edit_jobs`     | One applied edit's lifecycle: status, stage, per-stage timings, instruction, result, error, resulting run id.      |
| `graph_nodes`   | Engineering Graph nodes: type, canonical name, name, description, metadata, source artifact type.                  |
| `graph_edges`   | Engineering Graph edges: source, target, relationship, metadata.                                                   |

Every child row cascades from its `Project`, which cascades from its `User`.
Per-owner slug uniqueness (`ownerId + slug`) is scoped rather than global because
two users naming a project "Storefront" is normal. `GraphNode.runId` is
deliberately _not_ a foreign key: a node outlives the run that created it, so a
deleted `generations` row must not take the node with it.

Migrations live in `server/prisma/migrations`, from `init_postgres` through the
graph's folder nodes, `run_artifacts`, `edit_jobs`, the partial unique index that
enforces one active edit per project, and the indexes serving the edit-job
retention sweep.

### Generated output

`run_artifacts` is the half of the story `generations` does not tell. Before it
existed, generated code lived only in a `Map` inside the API process: the
`generations` row recorded that a build happened while the build itself evaporated
on the next restart, so a project showed a completed run whose Code tab, Preview
and editor had nothing to read — and the knowledge graph, persisted all along,
described a file tree that existed nowhere.

One row per run, the whole bundle as JSON. The reads are whole-bundle by nature
(the Code tab lists every file, the runner writes every file, an edit regenerates
from the same inputs), so splitting it across tables would buy nothing and cost a
join; Postgres stores a value this size out of line automatically.

`loadArtifacts` reads memory first, then the table, and caches what it read so the
next caller finds it in memory. `null` means genuinely unavailable — never
written, pruned away, or written by a build whose shape this one does not read —
and callers must say so rather than imply the run produced nothing.

Three real limits:

- **Retention: the newest 10 bundles per project** (`KEEP_PER_PROJECT` in
  `lib/run-artifact-store.ts`). Each bundle is a whole generated project, so an
  unbounded table grows by about a megabyte per build forever. Pruning runs after
  the write, not before: if pruning fails, the project still has its newest
  output.
- **A failed write never fails a run.** Losing the durable copy is bad; throwing
  away a generated project because a database was briefly unreachable is worse.
  Writes are logged and swallowed, and `saveRunArtifacts` returns whether it
  stored so a caller can report the truth.
- **With no `DATABASE_URL` the module is a no-op that says so**, rather than
  pretending to persist. Nothing generated survives a restart in that mode.

A stored bundle carries a schema `version`; one written by a build with a different
shape is skipped on read rather than half-understood.

### Process-local state, by design

In memory and gone on restart: live pipeline stage state (the last 20 runs),
agent-mesh runs, versioned agent artifacts, findings, repair sessions and history,
validation results, the agent-result cache, context cache, edit plans, builder
sessions and runner sessions. All of it is high-churn, cheap to recompute, or
meaningless outside the process that holds it. Stage state in particular flips
every few hundred milliseconds and would cost a row update per transition to serve
data worthless thirty seconds later.

With no `DATABASE_URL`, projects, the generation log and the Engineering Graph
additionally fall back to in-memory backends behind the same interfaces.

---

## Validation and repair

### Validation

The runtime, integration and test agents are a strict chain, not a wave: nothing
about integration is worth checking before the project runs, and nothing about
behaviour is worth testing before the parts are known to fit. The chain also keeps
the expensive step from running more than once — `npm install` on a generated
project is a minute or two before a single check has run.

The runtime engineer starts a Local Run session, and two more agents use it before
the validation is over, so no single agent can own the stop. The run does: the
scheduler releases the session when the run settles, whatever it settled as.

The gate is a decision procedure, not a score. Rules are checked in order and the
first one that fires wins; the summary carries the sentence saying which fired:

1. The project does not build or typecheck → `FAILED`
2. The application does not start → `FAILED`
3. Runtime up but integration/tests never ran → `BLOCKED`
4. Not one planned test actually executed → `BLOCKED`
5. A critical test failed, or integration failed → `FAILED`
6. Any non-critical failure, skip or block → `PASSED_WITH_WARNINGS`
7. Everything ran and passed → `PASSED`

Note what is absent: nothing about "production ready". A `PASSED` gate means these
checks ran and passed — a claim about this validation, not a promise about
production.

### Findings

A finding's id is derived from what it is about — `(project, type, category,
target)` — not from when it was created. Three review agents over one project will
notice the same missing authorization twice, and a second review a day later will
notice it again; with a random id per emission a reader sees the same problem three
times and cannot tell whether it was fixed in between. Keying on the subject means
the same problem is the same record, re-observed, so "still open after two reviews"
is a fact the store can answer. The key uses `category` and `target` rather than
the title, because titles carry counts and file names that shift between runs.

### Repair

`DETECT` is upstream in the finding store; `UNDERSTAND` is root-cause analysis;
`PLAN` names the only files the repair may touch; `PATCH` is a deterministic
strategy where the evidence is mechanical and a tightly-scoped model edit where it
is not; `VALIDATE` runs checks; and `ACCEPT`/`ROLLBACK` is decided from check
outcomes only. There is no path where a model's confidence substitutes for a
passing check.

Authorization is enforced at the one door through which a repair touches files: an
edit naming a file outside the plan's authorized set throws before anything is
touched, whether it came from a buggy deterministic strategy or a model that
wandered.

Files live inside versioned artifacts, so the "snapshot" before a repair is the
version that already exists and rollback is writing the prior content forward as
another version. History is never rewritten, even to undo.

Validation escalates rather than repeats: the first attempt runs the plan's
targeted checks, a retry runs the full set, because a second failure means the
targeted view was too narrow.

Five brakes, each with its own stop state:

| Brake                       | Stop state                       |
| --------------------------- | -------------------------------- |
| Attempts per finding        | `REJECTED`                       |
| Repairs per session         | `REPAIR_BUDGET_EXCEEDED`         |
| Wall-clock and token budget | `REPAIR_BUDGET_EXCEEDED`         |
| Fixed-then-back findings    | `REPAIR_LOOP`, never re-repaired |
| Regression on a baseline    | mandatory rollback, `REGRESSION` |

A finding is marked fixed only with validation evidence, never optimistically.
