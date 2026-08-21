/**
 * Contracts for the Local Run Engine (Phase 13) — "Run Project" as one
 * click. A run session materializes a generated project into a workspace
 * directory, installs dependencies, starts backend and frontend on
 * automatically detected free ports, and streams logs — with every phase
 * observable and every failure explained rather than swallowed. The
 * platform process never dies with a child: sessions fail, NexArch stays.
 */

/* ── Input ────────────────────────────────────────────────────────────── */

export interface RunnerFile {
  path: string;
  content: string;
}

export interface CreateSessionRequest {
  projectName: string;
  files: RunnerFile[];
  /** Extra environment for the child processes — merged over generated .env defaults. */
  env?: Record<string, string> | undefined;
}

/* ── Session lifecycle ────────────────────────────────────────────────── */

export type RunPhase =
  | 'preparing' // workspace being written
  | 'installing' // npm install running
  | 'configuring' // env files, prisma generate, database provisioning
  | 'starting' // processes spawned, waiting for ports + health to answer
  | 'running' // all processes up and answering over HTTP
  | 'stopping'
  | 'stopped'
  | 'restarting'
  | 'failed';

export type ProcessKind = 'backend' | 'frontend';

export type ProcessStatus = 'pending' | 'installing' | 'starting' | 'running' | 'exited';

export interface RunProcess {
  kind: ProcessKind;
  status: ProcessStatus;
  /** Automatically detected free port; null until allocated. */
  port: number | null;
  url: string | null;
  command: string;
  pid: number | null;
  exitCode: number | null;
}

export interface RunTransition {
  phase: RunPhase;
  at: string;
  detail: string;
}

export interface RunSession {
  id: string;
  projectName: string;
  phase: RunPhase;
  processes: RunProcess[];
  transitions: RunTransition[];
  workspaceDir: string;
  /** Readable failure diagnosis — never a raw stack trace. */
  diagnostics: string[] | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Planning ─────────────────────────────────────────────────────────── */

export interface RunStep {
  name: string;
  description: string;
}

/** Everything the runner will do, derived purely from the file set. */
export interface RunPlan {
  projectName: string;
  targets: {
    kind: ProcessKind;
    directory: string;
    installCommand: string;
    startCommand: string;
    /** The npm script `startCommand` displays — the supervisor spawns argv, never a shell string. */
    npmScript: string;
    envFile: { path: string; derivedFrom: string } | null;
    /** Target ships a prisma/schema.prisma — configure runs generate + db push for it. */
    prisma: boolean;
    /** HTTP path probed for readiness once the port answers. */
    healthPath: string;
  }[];
  steps: RunStep[];
  warnings: string[];
}

/* ── Logs ─────────────────────────────────────────────────────────────── */

export type LogStream = ProcessKind | 'system';

export interface RunLogLine {
  seq: number;
  stream: LogStream;
  line: string;
  at: string;
}

export interface RunLogChunk {
  lines: RunLogLine[];
  /** Pass back as `after` to receive only newer lines. */
  nextCursor: number;
}
