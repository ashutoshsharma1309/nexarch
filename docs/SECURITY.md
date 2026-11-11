# NexArch security model

What NexArch protects, what it does not, and the assumptions the implementation
makes about who is using it. This describes the system as it exists. Where
something is unverified, it is named as unverified rather than hedged.

## The one fact that governs everything else

**Generated code runs with the host user's privileges. There is no sandbox.**

Previewing a generated project runs `npm install` and then the project's own dev
servers as ordinary child processes with the full privileges of the developer
running NexArch: same user, same home directory, same ssh keys, same network, same
disk. `npm install` alone executes whatever the generated `package.json` put in
its lifecycle scripts, and `npm run dev` executes the script body itself. Neither
is confined.

The code being run is model-written. A generated `postinstall`, a dependency's
install script, or the application code itself can do anything you can do.

**No OS-level sandbox is in place and none has been verified here.** Docker is not
installed on this machine, and macOS `sandbox-exec` is deprecated and unverified,
so neither is claimed. The repository's compose files build and run _NexArch
itself_; they are not an isolation boundary around generated code, and nothing in
the preview path puts a generated project in a container.

So: NexArch is safe to run on code you are willing to execute locally — your own
prompts, your own machine. When web research feeds a build or an enhancement, part
of its input is third-party content, so "your own prompts" no longer covers
everything the generator read; see "Untrusted input" below. It is **not** safe to expose to arbitrary untrusted
users. Turning authentication on does not change that: an account that can submit a
prompt can get code executed on the host. This is not enterprise-ready and it is
not secure multi-tenant execution.

Real multi-tenant use would need OS-level isolation per run — a container or VM
with no host mount, its own network namespace, and a CPU and memory cap. That is
not implemented.

## What the runner does provide

Defence in depth around that fact, and nothing more. These are real properties of
the implementation, and none of them makes a generated project safe to run.

- **Writes are confined to the run workspace**, by path and by realpath. One module
  (`runner/lib/workspace-writer.ts`) owns the only containment rule — `isInside`
  and `resolveInside` — and every write plus the one recursive delete in the orphan
  reaper goes through it, because a containment check written twice is a
  containment check that disagrees with itself. The prefix test appends a path
  separator, so `/runs/app-1` cannot authorize `/runs/app-12`.
- **Children get a whitelisted environment**, not `process.env`. A child spawned
  with the platform's environment inherits NexArch's own `DATABASE_URL` and
  `JWT_SECRET` — and because dotenv never overrides variables that already exist,
  a generated backend would silently read the _platform_ database instead of its
  own. So a child gets a key only by being named in the whitelist, which means a
  new platform secret is excluded by default rather than needing to be remembered.
  Caller-supplied session environment never reaches that function.
- **Every spawn is an explicit executable plus an argv array with `shell: false`.**
  Commands come from the run plan, never from concatenated strings.
- **Every command has a deadline and dies as a process group.** The thing holding
  a port is the `tsx` or `vite` process npm forked, not the pid NexArch owns;
  signalling only the owned pid left orphans bound to ports with nothing left that
  knew how to stop them. Children are spawned detached so the whole group can be
  signalled.
- **No preview outlives the NexArch process that started it.** The supervisor
  sweeps its children on `exit` and on SIGTERM/SIGINT/SIGHUP. SIGKILL is the
  uncoverable case — nothing runs after it — so every long-running child records
  its pid, cwd and command before starting, and the next NexArch boot reaps what
  the killed one could not. A note is acted on only when the pid is still alive
  _and_ the live process's command line still points into the recorded workspace,
  because pids are recycled and killing a stranger's process is worse than leaving
  a port bound.

## The local single-user assumption

Authentication is **off by default** (`AUTH_DISABLED=true`), and the implementation
of that is worth understanding before relying on either mode.

In no-auth mode `requireAuth` short-circuits and attaches a single built-in
identity to every request: a fixed id (`local-user`), a fixed email, and the
`ADMIN` role (`server/src/modules/auth/lib/local-user.ts`). No token is issued and
none is verified. With a database configured, that user is materialized as a row so
it can own projects. Onboarding state for it lives in process memory and resets
with the server.

This means every request to a NexArch running in its default mode is a fully
authorized admin request. There is no login to fail and no credential to get
wrong. **Do not bind a default-mode NexArch to an interface anyone else can
reach.**

Two controls back that up. The server refuses to start with `AUTH_DISABLED=true`
under `NODE_ENV=production`. In any other mode, `requireAuth` answers no-auth
requests only when the TCP peer is loopback, using the socket address and never a
forwarded header. A reverse proxy on the same machine still appears as loopback, so
putting one in front of a no-auth server defeats this check. The compose stack
always runs with accounts on and publishes its ports on `127.0.0.1` unless
`BIND_ADDRESS` says otherwise.

The security status endpoint reports `Sandbox` as `WARNING`, or `FAIL` in
production, and never `PASS`, because of the isolation limit described above.

Turning accounts on (`AUTH_DISABLED=false` plus a `JWT_SECRET` of at least 32
characters — the boot refuses otherwise) restores real authentication: bcrypt
password hashing, a short-lived access token and a longer refresh token in
httpOnly, SameSite, Secure-in-production cookies, never readable by page script.
`requireAuth` then resolves the token to a real user row on every request, so a
deleted account's still-valid token stops working immediately. A `Bearer` header
is accepted for non-browser callers.

Owner-scoping is in place in both modes, not switched on with accounts. Every
project-scoped read resolves the project through the caller's id _before_ touching
any data, and runs, agent runs, builder sessions, runner sessions, edit jobs and
edit plans each resolve through their owner. Something that is not yours reads as
`404`, identical to something that never existed, so an id cannot be probed for
existence across users. In no-auth mode there is one owner, so everything belongs
to the local user; with accounts on the same code isolates per account with no
further change.

## Single-instance assumptions

**The boot-time reconciliation sweeps assume exactly one server instance, and a
second instance starting beside a live one would settle the live one's in-flight
work.**

Two sweeps run before the socket opens (`server/src/index.ts`):

- `reconcileInterruptedRuns` marks every `generations` row in a non-terminal status
  as `FAILED`.
- `reconcileInterruptedJobs` marks every `edit_jobs` row in `QUEUED` or `RUNNING`
  as `INTERRUPTED`.

Both are unscoped `updateMany` statements over the whole table. There is no
instance id, no lease and no heartbeat check in either predicate. So a second
instance pointed at the same database will, on boot, declare the first instance's
genuinely-running build failed and its genuinely-running edit interrupted — while
that work carries on in the other process and then writes its own result over the
reconciled row. The user sees a build that failed and then succeeded, or an edit
reported interrupted that was in fact applied.

The orphan reaper has a related assumption with a narrower blast radius: it kills
processes whose recorded workspace still matches the live command line, which
includes previews a _concurrently running_ NexArch started.

Scaling horizontally needs per-instance job ownership first — a lease column or an
instance id in the predicate. Until then, run one instance per database.

## Preview concurrency

Concurrency limits here are about keeping a developer machine usable, not about
containment. They are not a security boundary: a single run is already unconfined.

- In-flight runs per owner: `NEXARCH_RUNNER_MAX_SESSIONS`, default 2.
- In-flight runs machine-wide across every owner:
  `NEXARCH_RUNNER_MAX_ACTIVE_TOTAL`, default four times the per-owner cap. These
  are deliberately two different facts: the validation mesh holds sessions under an
  internal owner tag, and counting those against a user's budget refused that user
  a preview while telling them to stop a session their list did not show. A limit
  may only be enforced over the set the caller can act on.
- Concurrent `npm install`s: `NEXARCH_RUNNER_MAX_INSTALLS`, default 1.
- In-memory session records: capped at 30, evicting terminal ones.
- Builder Agent sessions: one running session per owner, because a session installs
  and starts a whole application.

A generated application can fork without bound, spend CPU, fill the disk and
saturate the network inside its own session; no limit above constrains any of
that.

## Network and filesystem exposure

**The platform process.** `server.listen(config.server.port)` is called with no
host, so the API binds every interface on `PORT` (default 4000) — treat it as
reachable from the network unless you have arranged otherwise. The console's Vite
dev server sets only `port: 5173` and relies on Vite's own default host.

CORS is deny-by-default against the `CORS_ORIGINS` allow-list: an absent origin
gets no CORS headers at all rather than an error response. Helmet applies its
defaults plus a `default-src 'none'` CSP and `frame-ancestors 'none'`; bodies are
capped at 1 MB globally and 8 MB on the two edit routes that accept a reference
image; `x-powered-by` is disabled. `trust proxy` is set to one hop only, so client
IPs behind a single reverse proxy are correct for rate limiting and logs while
arbitrary forwarded chains are not trusted.

Rate limiting is three budgets, not one. The global per-IP window is
`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS` (defaults: 100 per 60s). Polled reads
are skipped by it and metered separately at 600 per minute, so a running preview
cannot starve the rest of the API — including the token refresh that keeps a
session alive, which is bounded by its own limiter in the auth router. Expensive
operations (agent runs, repairs, builder sessions) get 12 per five minutes, keyed
by authenticated user and falling back to IP, so one tenant cannot exhaust the
budget for everyone behind a proxy.

**Generated applications.** A preview binds its own ports — the first free ones
from 4000 for the backend and 5173 for the frontend — and whatever those dev
servers choose to serve is served. Generated apps are public MVPs by default
(`GENERATED_APP_AUTH=false`): no login pages, no guarded routes. A preview is a
publicly-readable application on your machine's ports for as long as it runs.

**The filesystem.** NexArch writes generated projects under its run workspace root
(`NEXARCH_RUNNER_DIR`, default the OS temp directory), and each workspace carries
its own installed `node_modules`. Old workspaces are pruned at boot. That is where
NexArch _writes_; it says nothing about what a generated project reads, which is
everything the host user can read.

## Secret handling

- The model key is read server-side only. It never appears in an API response, the
  client bundle, or a browser request.
- One general redactor (`shared/security/redact.ts`) guards logs and audit events.
  It walks objects and arrays so a structured payload is scrubbed whole, matches on
  both sensitive key names and secret-shaped values (provider keys, bearer tokens,
  JWTs, PEM private keys, credentials embedded in a URL, and the
  `SOMETHING_KEY=value` assignment form), and errs toward over-redacting: a log
  line that loses a token to a false positive is a nuisance, a log line that keeps
  one is an incident.
- A separate sanitizer scrubs the assembled context package before it reaches a
  model. Prompt variables and untrusted data are not sanitized, so a secret written
  into a project file can reach a model provider. The export package walks every value through the redactor before it becomes a file.
- A generated project never receives a platform secret: the child environment is a
  whitelist.

## Untrusted input that is treated as untrusted

- **Web content read during research.** It is third-party controlled and it can
  steer what gets generated, so "your own prompts" stops being true once research
  runs. It is delimited as untrusted data for the planner, and a plan built on it
  reaches the implementer the same way. An enhancement whose plan used research may
  not add packages. Everything is installed with `--ignore-scripts`; only the
  packages named in `INSTALL_SCRIPT_PACKAGES` run install scripts afterwards. A
  registry package that the generated code imports still runs when the app starts,
  which is the sandbox gap described above.
- **Imported project packages.** Import is the adversarial direction. The schema
  version is checked, the size is bounded, artifact file paths are rejected if they
  traverse or absolute-escape, graph edges are validated, and nothing in a package
  is ever executed. A malformed or hostile package is rejected with a reason rather
  than partially applied.
- **Reference images.** The claimed content type is ignored and the magic number
  read instead; the size limit is enforced on the decoded bytes; dimensions come
  from the format's own header. Nothing interprets the image's content — the
  reading prompt treats it as a thing to describe, never as an instruction.
- **Model output.** Tool arguments from a model are schema-validated. Identifiers
  that matter — project, run, preview — come from the Builder Agent session's own
  state and never from model-supplied arguments. `inspect_website` fetches only
  the local URLs the runner handed back, so a model cannot point it elsewhere.
  Repair edits naming a file outside the plan's authorized set throw before
  anything is touched, whether they came from a buggy deterministic strategy or a
  model that wandered.
- **Run file paths.** Paths in a run request come from the request body and are
  rejected for traversal before any write.

## Safe usage expectations

1. Run NexArch on your own machine, for your own prompts. One instance per
   database.
2. Treat every previewed project as code you have chosen to execute. Read what it
   generated before running it if that matters to you.
3. Do not expose the API or the console to a network you do not control, in either
   auth mode.
4. Do not use this for untrusted users or untrusted prompts. There is no boundary
   that would make that safe.
5. Give `NEXARCH_RUNNER_DATABASE_URL` a least-privilege MySQL user scoped to
   `nexarch_run_%` databases, not a root account.
6. Keep real credentials in `server/.env`, which is git-ignored. Nothing is needed
   in `server/.env.example` but placeholders.

## Known limitations

- No OS-level sandbox for generated code (above).
- The boot reconciliation sweeps assume a single instance (above).
- Retention deletes history, so neither table is an audit log. `run_artifacts` keeps
  the newest 10 bundles per project; finished `edit_jobs` rows are deleted past
  `EDIT_JOB_RETENTION_DAYS` (default 30), keeping each project's newest finished job.
- The `review` module is an intentional scaffold: its routes answer as a scaffold
  and no static-analysis or optimization pass is wired behind them.
- Deploy providers ship disabled until their token is set. Planning and status
  endpoints work with no secrets; the execution step does not run without one.
