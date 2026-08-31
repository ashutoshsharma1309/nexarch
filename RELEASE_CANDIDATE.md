# NexArch v2.0 — Release Manifest

**FROZEN RELEASE CANDIDATE** — Phases 1–17 complete.

| Field               | Value                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Project             | NexArch v2.0                                                                                                                |
| Status              | **FROZEN RELEASE CANDIDATE**                                                                                                |
| Application version | 0.1.0 (root / server / client)                                                                                              |
| Branch              | `main`                                                                                                                      |
| Baseline commit     | `ef09c81` (Phase 15)                                                                                                        |
| Frozen              | 2026-08-28                                                                                                                  |
| Node / npm          | v22.20.0 / 10.9.3                                                                                                           |
| Database schema     | MySQL 8 · Prisma 6 · 5 migrations · up to date, no drift                                                                    |
| Environment         | `server/.env` from `server/.env.example` (placeholders only); `DATABASE_URL` + `JWT_SECRET` required, `AI_API_KEY` optional |
| Release decision    | **RELEASE_READY**                                                                                                           |

This is the release record for Phases 16–17. Phase 16 audited the release
candidate and fixed the defects below; Phase 17 packaged it for reproducible
setup and a hackathon demo, then froze it. History is preserved — nothing was
deleted.

---

## Gate summary

| Gate                                         | Result                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| TypeScript (server + client)                 | **PASS**                                                                                                   |
| Lint (server + client)                       | **PASS**                                                                                                   |
| Unit tests (server)                          | **PASS** — 535/535                                                                                         |
| Integration tests (server)                   | **PASS** — 21/21                                                                                           |
| Client tests                                 | **PASS** — 44/44                                                                                           |
| Security (auth/isolation/secret-leak/import) | **PASS** (after Phase 16 fixes)                                                                            |
| Secret scan (tracked files)                  | **PASS** — none                                                                                            |
| Dependency audit                             | **PASS** — 0 critical (bcrypt→6 remediated); 3 high are dev-only Prisma CLI tooling, not runtime-reachable |
| Performance                                  | **PASS** — all core endpoints < 35 ms                                                                      |
| Clean install (isolated copy)                | **PASS** — fresh install → generate → typecheck → build                                                    |
| Production build (server + client)           | **PASS**                                                                                                   |
| Production-build run                         | **PASS** — compiled `dist` boots + serves register/demo/list                                               |
| Full agent mesh (14 agents)                  | **PASS** — completes end to end (verified again after fixes)                                               |
| Demo reliability                             | **PASS** — 10/10 runs, byte-identical, avg 0.25 s                                                          |
| DB consistency                               | **PASS** — 0 orphans/duplicates across 63 projects                                                         |

**Release gate: RELEASE_READY** — no P0 open, no unresolved P1, no unresolved
critical security issue in the runtime surface.

---

## Post-freeze critical fixes

- **Build prompt validation mismatch (P1, fixed).** The Build tab's button posts to the
  legacy `pipeline` endpoint, whose validator capped the prompt at 2000 chars (min 15),
  while the client form and the agent-orchestrator build both use 20–4000. A form-valid
  prompt over 2000 chars therefore failed with a confusing `422`. Aligned the pipeline
  validator to 20–4000 so all three agree. Verified live (2434-char prompt now `202`;
  a too-short prompt still `422`) and full suite green (535 + 21).
  _Note: a cold-load `GET /auth/me` `401` seen alongside it is the normal session
  refresh-and-retry, not a defect._

## Phase 17 — release engineering

- **Secret audit:** no live secret pattern in any tracked file; `.env` gitignored;
  `.env.example` carries placeholders only; the previously-pasted provider key is absent.
- **Dependency audit + remediation:** upgraded `bcrypt` 5→6 (verified: builds, and
  hash/compare + live register/login all pass), which removes the vulnerable
  `node-pre-gyp`/`tar` install-time chain — **the one critical advisory is resolved.**
  The 3 remaining high advisories are `deepmerge-ts` pulled only by the Prisma **CLI**
  (a devDependency); not shipped in the runtime, not reachable with user input.
- **Reproducible setup:** a clean copy (no `node_modules`) installs, generates the Prisma
  client, typechecks and builds with only the documented commands.
- **Demo reliability:** 10/10 demo runs succeeded, byte-identical each time
  (avg 0.25 s, max 0.83 s), reset-in-place; the demo hash matches across sessions.
- **Documentation:** README brought in line with the actual implementation — agent
  system, engineering graph, self-repair, token optimization, security, environment
  table, testing, troubleshooting; the stale API table and removed-screen references
  were corrected.
- **Filesystem hygiene (host):** ~12 GB of accumulated runner workspace dirs and some
  orphaned generated-app dev servers exist on the development host from cumulative
  testing; these are test residue, not part of the repo or a fresh environment.

---

## Bugs found and fixed in Phase 16

All were reproduced, root-caused, fixed, and re-verified live.

### P0 — blockers

1. **Runner was fully unauthenticated** (`runner.router.ts`) — anonymous callers
   could create a run session, which writes files and executes `npm install` /
   `npm run dev` (arbitrary lifecycle scripts): unauthenticated RCE. Sessions
   also had no owner.
   **Fix:** router-wide `requireAuth`; every session is owned by its creator;
   all lookups (`getSession`/`getLogs`/`stop`/`restart`/`list`) are owner-scoped;
   the validation mesh's internal sessions use a reserved internal owner tag.
   **Verified:** unauth → 401; cross-user list = 0, get/stop = 404.

2. **Pipeline runs had no ownership** (`pipeline.service.ts`) — any authed user
   could list every tenant's runs and download another tenant's generated source
   via `GET /pipeline/runs`, `/runs/:id/artifacts`, `/runs/:id/retry`.
   **Fix:** each run carries an `ownerId`; list filters by owner; get/artifacts/
   retry resolve through an owner-checked accessor (not-yours → 404).
   **Verified:** cross-user list = 0; get/artifacts/retry = 404; own run = 200.

### P1 — critical

3. **`GET /history` + `POST /documentation` unauthenticated, history cross-tenant**
   (`workspace.router.ts`) — the notification feed exposed every tenant's
   generation/activity records to anonymous callers.
   **Fix:** `requireAuth` on both; history is scoped to the caller's own projects
   (unknown/foreign `projectId` → 404).
   **Verified:** unauth → 401; foreign projectId → 404; other tenant sees 0.

4. **Deployment router unauthenticated** (`deployment.router.ts`) —
   `execute`/`executions`/etc. reachable anonymously (could trigger real deploys
   with operator-held provider credentials, when configured).
   **Fix:** router-wide `requireAuth`. **Verified:** unauth → 401.

### P2 — important

5. **AI-orchestrator router unauthenticated** (`ai-orchestrator.router.ts`) —
   `generate`/`retry`/`workflow` burned real provider tokens anonymously;
   `history`/`statistics` leaked usage metadata. **Fix:** `requireAuth`.
   **Verified:** unauth → 401.

6. **Insights `/generate` unauthenticated** (`insights.router.ts`).
   **Fix:** `requireAuth`. **Verified:** unauth → 401.

7. **Agent-orchestrator GET route mis-wired to mutating handlers**
   (`agent-orchestrator.router.ts`) — the `…/artifacts/project-files` GET chained
   five extra handlers, including the mutating `startRepairsHandler`/
   `updateFindingHandler`; inert only because the first handler ended the
   response. **Fix:** reduced to the single correct handler.

### P3 — minor

8. **Pure-compute generator routers unauthenticated** (analysis, architecture,
   backend-generator, frontend-generator, database, openapi, dependency-graph,
   quality, security-engine) — anonymous CPU/DoS, no data exposure.
   **Fix:** `requireAuth` across all (defense-in-depth). **Verified:** unauth → 401.

9. **Dead client code** — four orphaned service modules (`quality`, `deployment`,
   `insights`, `ai-orchestrator`) with zero importers. **Fix:** removed (Step 44).

---

## Verified working (evidence)

- **Full 14-agent mesh** completes end to end (requirement-analyst → …
  → test-engineer), real AI, ~$0.005/run.
- **Engineering graph** validates clean (111 nodes / 154 edges, 0 issues, 0 orphans).
- **Demo Mode** deterministic across 5 runs (identical core hash), reset-in-place,
  labelled, credential-free.
- **Fresh-user journey:** signup → onboarding → create → demo → export → import →
  logout, each step real.
- **Isolation:** cross-user access to projects, runs, runner sessions, history and
  export all return 404; other tenant's lists are empty.
- **Import security:** traversal, absolute, null-byte, Windows-absolute, bad
  version, bad artifact type all rejected (400). **Export:** no secret patterns;
  redaction markers present; the provider key is untracked and absent from all
  tracked files.
- **Performance:** projects 16 ms, dashboard 4 ms, graph 25 ms, intelligence 34 ms,
  validate 30 ms.

---

## Known issues (non-blocking)

- **In-memory state (by design).** Artifacts, findings, repairs, pipeline run
  status, the agent-result cache and runner sessions are process-local; a server
  restart drops prior-process run state (projects and the engineering graph
  persist in MySQL). Documented architecture choice, not a regression.
- **Two build entry points** in the Build tab (legacy one-call pipeline button +
  the agent-mesh runtime panel). Both work; a future pass should consolidate them.
- **Context-engine diagnostics** (`/context/benchmark`, `/stats`, `/trace`) are
  authenticated but not production-gated; `benchmark` with `callModel:true` can
  incur model cost for an authed caller. No unauth or data exposure.
- **Browser audit** was performed at the HTTP level — no headless browser is
  available in this environment.
- Login logs the submitted email on a failed sign-in (PII, not a secret).
