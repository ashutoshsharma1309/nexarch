/**
 * Turns the event log into what the Activity view shows.
 *
 * Pure, and only ever reads what was recorded. A stage is running because a
 * `stage.started` arrived and nothing ended it. Durations are the server's
 * own, or the gap between two server timestamps; the browser's clock is never
 * consulted, so a slow stage cannot appear to move.
 */
import type {
  ExecutionEvent,
  ExecutionJobKind,
  ExecutionJobSummary,
  StageUsageRecord,
} from '@/shared/types/execution';
import { canonicalStage, stageLabel } from './execution-format';

export type ExecutionDisplayStatus =
  | 'queued'
  | 'researching'
  | 'planning'
  | 'implementing'
  | 'testing'
  | 'repairing'
  /** Started, with no stage open right now. */
  | 'working'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'rejected'
  | 'unknown';

export type StageDisplayStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'interrupted'
  /** Events exist for it, but nothing said when it began or ended. */
  | 'recorded';

export interface PlannedStage {
  id: string;
  label: string;
  status?: string;
  agentId?: string | null;
  engine?: string | null;
  responsibility?: string | null;
}

export interface LogLine {
  seq: number;
  at: string;
  message: string;
}

export interface ModelCallView {
  seq: number;
  provider: string;
  model: string;
  ok: boolean;
  durationMs: number | null;
  fallback: boolean;
  error: string | null;
  /** Made while planning and only recorded when the job started. */
  fromPlanning: boolean;
}

export interface CheckView {
  seq: number;
  id: string;
  status: string;
  summary: string;
  command: string | null;
  exitCode: number | null;
  durationMs: number | null;
}

export interface VerifyOutcome {
  ok: boolean;
  durationMs: number | null;
  failed: string[];
  limitations: string[];
}

export interface RepairView {
  seq: number;
  attempt: number;
  maxAttempts: number | null;
  targets: string[];
}

export interface RepairOutcome {
  attempts: number;
  repaired: boolean;
}

export interface SourceView {
  url: string;
  title: string;
  retrieval: string;
}

export interface QueryView {
  provider: string;
  query: string;
  results: number | null;
}

export interface UsageTotals {
  calls: number;
  /** Null when no call reported this figure. */
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  /** Calls that did not report the figure, so a total is only a lower bound. */
  unreportedTokens: number;
  unreportedCost: number;
}

export interface FileChanges {
  created: string[];
  modified: string[];
  deleted: string[];
}

export interface StageView {
  id: string;
  label: string;
  status: StageDisplayStatus;
  agentId: string | null;
  engine: string | null;
  responsibility: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
  degraded: boolean;
  log: LogLine[];
  models: ModelCallView[];
  files: FileChanges;
  plannedFiles: string[];
  artifacts: string[];
  /** Its research happened during planning, not at this point in the job. */
  researchFromPlanning: boolean;
  sources: SourceView[];
  queries: QueryView[];
  limitations: string[];
  checks: CheckView[];
  verifyOutcome: VerifyOutcome | null;
  repairs: RepairView[];
  repairOutcome: RepairOutcome | null;
  usage: UsageTotals | null;
}

export interface ExecutionView {
  status: ExecutionDisplayStatus;
  isActive: boolean;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  lastEventAt: string | null;
  currentStage: StageView | null;
  /** The newest recorded line, while the job is still going. */
  currentOperation: string | null;
  stages: StageView[];
  errors: string[];
  /** Job-level lines with no stage, such as an enhancement being applied. */
  notes: LogLine[];
  files: FileChanges;
  verification: VerifyOutcome | null;
  usage: UsageTotals | null;
  hasHistory: boolean;
}

export interface BuildViewInput {
  jobKind: ExecutionJobKind;
  events: ExecutionEvent[];
  usage: StageUsageRecord[];
  summary: ExecutionJobSummary | null;
  /** Stages the server has declared, in order. Empty when it declared none. */
  plan: PlannedStage[];
  /** The feed closed: nothing further will arrive for this job. */
  feedEnded: boolean;
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function newStage(id: string, plan?: PlannedStage): StageView {
  return {
    id,
    label: plan?.label ?? stageLabel(id),
    status: 'recorded',
    agentId: plan?.agentId ?? null,
    engine: plan?.engine ?? null,
    responsibility: plan?.responsibility ?? null,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    summary: null,
    error: null,
    degraded: false,
    log: [],
    models: [],
    files: { created: [], modified: [], deleted: [] },
    plannedFiles: [],
    artifacts: [],
    researchFromPlanning: false,
    sources: [],
    queries: [],
    limitations: [],
    checks: [],
    verifyOutcome: null,
    repairs: [],
    repairOutcome: null,
    usage: null,
  };
}

function gap(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isNaN(ms) || ms < 0 ? null : ms;
}

function endStage(
  stage: StageView,
  status: StageDisplayStatus,
  event: ExecutionEvent,
  data: Record<string, unknown>,
): void {
  stage.status = status;
  stage.endedAt = event.createdAt;
  stage.durationMs = asNumber(data.durationMs) ?? gap(stage.startedAt, event.createdAt);
}

/** Applies one event to its stage. Only known fields are read: no raw payload is ever kept. */
function applyToStage(stage: StageView, event: ExecutionEvent): void {
  const data = event.data ?? {};
  stage.agentId = event.agentId ?? stage.agentId;
  stage.log.push({ seq: event.seq, at: event.createdAt, message: event.message });

  switch (event.type) {
    case 'stage.started':
      stage.status = 'running';
      stage.startedAt = event.createdAt;
      break;
    case 'stage.completed':
      endStage(stage, 'completed', event, data);
      stage.summary = asString(data.summary) ?? stage.summary;
      stage.degraded = data.degraded === true;
      break;
    case 'stage.failed':
      endStage(stage, 'failed', event, data);
      stage.error = asString(data.error) ?? event.message;
      break;
    case 'stage.skipped':
      endStage(stage, 'skipped', event, data);
      stage.summary = asString(data.reason) ?? event.message;
      break;
    case 'agent.started':
      stage.responsibility = asString(data.task) ?? stage.responsibility;
      stage.engine = asString(data.engine) ?? stage.engine;
      break;
    case 'agent.completed':
      stage.artifacts.push(...asStrings(data.artifacts));
      break;
    case 'agent.failed':
      stage.error ??= asString(data.error) ?? event.message;
      break;
    case 'model.call':
      stage.models.push({
        seq: event.seq,
        provider: asString(data.provider) ?? 'unknown',
        model: asString(data.model) ?? 'unknown',
        ok: event.status !== 'failed',
        durationMs: asNumber(data.durationMs),
        fallback: data.fallback === true,
        error: asString(data.error),
        fromPlanning: data.replayed === true,
      });
      break;
    case 'research.query':
      if (data.replayed === true) stage.researchFromPlanning = true;
      stage.queries.push({
        provider: asString(data.provider) ?? 'unknown',
        query: asString(data.query) ?? event.message,
        results: asNumber(data.results),
      });
      break;
    case 'research.source': {
      if (data.replayed === true) stage.researchFromPlanning = true;
      const url = asString(data.url);
      if (url) {
        stage.sources.push({
          url,
          title: asString(data.title) ?? url,
          retrieval: asString(data.retrieval) ?? 'unknown',
        });
      }
      break;
    }
    case 'research.limitation':
      stage.limitations.push(asString(data.detail) ?? event.message);
      break;
    case 'files.changed':
      stage.files.created.push(...asStrings(data.created));
      stage.files.modified.push(...asStrings(data.modified));
      stage.files.deleted.push(...asStrings(data.deleted));
      break;
    case 'enhancement.planned':
      stage.plannedFiles.push(...asStrings(data.files));
      break;
    case 'verify.check':
      stage.checks.push(checkFrom(event, data));
      break;
    case 'verify.completed':
      stage.verifyOutcome = {
        ok: data.ok === true,
        durationMs: asNumber(data.durationMs),
        failed: asStrings(data.failed),
        limitations: asStrings(data.limitations),
      };
      break;
    case 'repair.attempt':
      stage.repairs.push({
        seq: event.seq,
        attempt: asNumber(data.attempt) ?? stage.repairs.length + 1,
        maxAttempts: asNumber(data.maxAttempts),
        targets: asStrings(data.targets),
      });
      break;
    case 'repair.completed':
      stage.repairOutcome = {
        attempts: asNumber(data.attempts) ?? stage.repairs.length,
        repaired: data.repaired === true,
      };
      break;
    default:
      break;
  }
}

function checkFrom(event: ExecutionEvent, data: Record<string, unknown>): CheckView {
  const id = asString(data.id) ?? 'check';
  const route =
    id === 'route'
      ? `${asString(data.method) ?? ''} ${asString(data.path) ?? ''}: got ${
          asNumber(data.actualStatus)?.toString() ?? 'no response'
        }, expected ${asNumber(data.expected)?.toString() ?? asString(data.expected) ?? 'any'}`.trim()
      : null;
  return {
    seq: event.seq,
    id,
    status: event.status ?? 'info',
    summary: route ?? asString(data.summary) ?? event.message,
    command: asString(data.command),
    exitCode: asNumber(data.exitCode),
    durationMs: asNumber(data.durationMs),
  };
}

/**
 * A row with no provider and no figures only timed deterministic work. It is
 * not a model call, and counting it would report calls that never happened.
 */
function isModelUsage(record: StageUsageRecord): boolean {
  return (
    record.provider !== null ||
    record.model !== null ||
    record.inputTokens !== null ||
    record.outputTokens !== null ||
    record.costUsd !== null
  );
}

function addKnown(total: number | null, value: number | null): number | null {
  if (value === null) return total;
  return (total ?? 0) + value;
}

export function totalUsage(records: StageUsageRecord[]): UsageTotals | null {
  const calls = records.filter(isModelUsage);
  if (calls.length === 0) return null;
  const totals: UsageTotals = {
    calls: calls.length,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    unreportedTokens: 0,
    unreportedCost: 0,
  };
  for (const call of calls) {
    totals.inputTokens = addKnown(totals.inputTokens, call.inputTokens);
    totals.outputTokens = addKnown(totals.outputTokens, call.outputTokens);
    totals.costUsd = addKnown(totals.costUsd, call.costUsd);
    if (call.inputTokens === null || call.outputTokens === null) totals.unreportedTokens += 1;
    if (call.costUsd === null) totals.unreportedCost += 1;
  }
  return totals;
}

const STAGE_STATUS: Record<string, ExecutionDisplayStatus> = {
  queued: 'queued',
  research: 'researching',
  researching: 'researching',
  analysis: 'planning',
  decision: 'planning',
  'design-intelligence': 'planning',
  architecture: 'planning',
  database: 'planning',
  planning: 'planning',
  backend: 'implementing',
  frontend: 'implementing',
  security: 'implementing',
  dependencies: 'implementing',
  graph: 'implementing',
  implementing: 'implementing',
  verification: 'testing',
  testing: 'testing',
  repair: 'repairing',
  repairing: 'repairing',
};

const TERMINAL_EVENT_STATUS: Record<string, ExecutionDisplayStatus> = {
  'job.completed': 'completed',
  'job.failed': 'failed',
  'job.cancelled': 'cancelled',
  'job.interrupted': 'interrupted',
};

const SETTLED_SUMMARY_STATUS: Partial<Record<string, ExecutionDisplayStatus>> = {
  succeeded: 'completed',
  failed: 'failed',
  rejected: 'rejected',
  cancelled: 'cancelled',
  interrupted: 'interrupted',
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** How many events can have changed the usage figures. */
export function usageRevision(events: ExecutionEvent[]): number {
  return events.filter(
    (event) =>
      event.type === 'stage.completed' ||
      event.type === 'stage.failed' ||
      event.type in TERMINAL_EVENT_STATUS,
  ).length;
}

export function buildExecutionView(input: BuildViewInput): ExecutionView {
  const { jobKind, events, usage, summary, plan, feedEnded } = input;
  const planned = new Map(plan.map((stage) => [stage.id, stage]));
  const rows = new Map<string, StageView>();
  const errors: string[] = [];
  const notes: LogLine[] = [];
  let startedAt: string | null = null;
  let terminal: ExecutionEvent | null = null;

  for (const event of events) {
    const stageId = event.stage ? canonicalStage(jobKind, event.stage) : null;
    if (event.type === 'job.started') {
      startedAt = event.createdAt;
      continue;
    }
    if (event.type in TERMINAL_EVENT_STATUS) {
      terminal = event;
      if (event.type === 'job.failed') {
        const error = asString(event.data?.error) ?? event.message;
        errors.push(error);
        const stage = stageId ? rows.get(stageId) : undefined;
        if (stage?.status === 'running') {
          stage.status = 'failed';
          stage.endedAt = event.createdAt;
          stage.durationMs = gap(stage.startedAt, event.createdAt);
          stage.error ??= error;
        }
      }
      continue;
    }
    if (!stageId) {
      notes.push({ seq: event.seq, at: event.createdAt, message: event.message });
      continue;
    }
    let stage = rows.get(stageId);
    if (!stage) {
      stage = newStage(stageId, planned.get(stageId));
      rows.set(stageId, stage);
    }
    applyToStage(stage, event);
    if (event.type === 'stage.failed' && stage.error) errors.push(stage.error);
  }

  const status = overallStatus(terminal, summary, rows, feedEnded, events.length);
  const isActive = !TERMINAL_DISPLAY.has(status);
  const interruptedAs: StageDisplayStatus = status === 'cancelled' ? 'cancelled' : 'interrupted';

  for (const stage of rows.values()) {
    if (!isActive && stage.status === 'running') {
      // Nothing closed this stage before the job ended, so it did not finish.
      stage.status = interruptedAs;
    }
    const records = usage.filter((row) => canonicalStage(jobKind, row.stage) === stage.id);
    stage.usage = totalUsage(records);
  }

  const stages = orderStages(plan, rows, isActive);
  const lastEvent = events.at(-1) ?? null;
  const currentStage = [...stages].reverse().find((stage) => stage.status === 'running') ?? null;
  const endedAt = terminal?.createdAt ?? null;
  const terminalMs = asNumber(terminal?.data?.durationMs);
  const verification = [...stages].reverse().find((stage) => stage.verifyOutcome);

  return {
    status,
    isActive,
    startedAt: startedAt ?? summary?.createdAt ?? null,
    endedAt,
    durationMs: terminalMs ?? gap(startedAt ?? summary?.createdAt ?? null, endedAt),
    lastEventAt: lastEvent?.createdAt ?? summary?.lastEventAt ?? null,
    currentStage,
    currentOperation: isActive ? (lastEvent?.message ?? null) : null,
    stages,
    errors: unique(errors),
    notes,
    files: {
      created: unique(stages.flatMap((stage) => stage.files.created)),
      modified: unique(stages.flatMap((stage) => stage.files.modified)),
      deleted: unique(stages.flatMap((stage) => stage.files.deleted)),
    },
    verification: verification?.verifyOutcome ?? null,
    usage: totalUsage(usage),
    hasHistory: events.length > 0,
  };
}

const TERMINAL_DISPLAY = new Set<ExecutionDisplayStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'rejected',
  'unknown',
]);

function overallStatus(
  terminal: ExecutionEvent | null,
  summary: ExecutionJobSummary | null,
  rows: Map<string, StageView>,
  feedEnded: boolean,
  eventCount: number,
): ExecutionDisplayStatus {
  if (terminal) return TERMINAL_EVENT_STATUS[terminal.type] ?? 'unknown';
  const settled = summary ? SETTLED_SUMMARY_STATUS[summary.status] : undefined;
  if (settled) return settled;
  // The server closed the feed without saying how the job ended: do not guess.
  if (feedEnded || summary?.status === 'unknown') return 'unknown';
  const open = [...rows.values()].reverse().find((stage) => stage.status === 'running');
  if (open) return STAGE_STATUS[open.id] ?? 'working';
  if (summary?.status === 'queued') return 'queued';
  return summary || eventCount > 0 ? 'working' : 'unknown';
}

/**
 * Declared stages first, in order; anything the job recorded beyond them after.
 * A declared stage with no events is pending only if it lies ahead of the work
 * so far: one that was passed over, or belongs to a job now over, did not run.
 */
function orderStages(
  plan: PlannedStage[],
  rows: Map<string, StageView>,
  isActive: boolean,
): StageView[] {
  const furthest = plan.reduce((last, stage, index) => (rows.has(stage.id) ? index : last), -1);
  const ordered: StageView[] = [];
  plan.forEach((item, index) => {
    const row = rows.get(item.id);
    if (row) {
      ordered.push(row);
    } else if (isActive && index > furthest) {
      ordered.push({ ...newStage(item.id, item), status: 'pending' });
    }
  });
  const declared = new Set(plan.map((stage) => stage.id));
  for (const row of rows.values()) {
    if (!declared.has(row.id)) ordered.push(row);
  }
  return ordered;
}
