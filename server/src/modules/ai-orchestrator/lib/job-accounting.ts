/**
 * Per-job model spend: the ceilings that stop a runaway loop, and the durable
 * record of what each call used.
 *
 * The job comes from the ambient log context, which `startRun` and the edit
 * worker already fork around their work, so no call site has to thread an id
 * through. A call made outside any job (a direct `/ai` request) is neither
 * limited nor persisted: there is no job to charge it to.
 */
import { currentLogContext } from '../../../shared/logger/context.js';
import { recordStageUsage } from '../../execution-events/execution-events.service.js';
import type { ModelUsage, ProviderId } from '../ai-orchestrator.types.js';
import { NonRetryableError } from './retry-manager.js';

export interface JobBinding {
  jobId: string;
  /** Absent for a run with no project, whose usage has nowhere durable to go. */
  projectId?: string;
  /** Where the job is now; the prompt id stands in when nothing says. */
  stage?: string;
  agentId?: string;
}

/** Well past a normal job (tens of calls) and well short of a loop's bill. */
const DEFAULT_TOKEN_CEILING = 1_500_000;
/** Separate from tokens: calls that keep failing report no tokens at all. */
const DEFAULT_CALL_CEILING = 150;
/** Jobs have no end hook here, so the ledger is bounded rather than cleared. */
const MAX_TRACKED_JOBS = 1_000;

interface Ledger {
  calls: number;
  tokens: number;
  promptCalls: Map<string, number>;
}

const ledgers = new Map<string, Ledger>();

function ledgerFor(jobId: string): Ledger {
  let ledger = ledgers.get(jobId);
  if (ledger === undefined) {
    ledger = { calls: 0, tokens: 0, promptCalls: new Map() };
    ledgers.set(jobId, ledger);
    if (ledgers.size > MAX_TRACKED_JOBS) {
      const oldest = ledgers.keys().next().value;
      if (oldest !== undefined) ledgers.delete(oldest);
    }
  }
  return ledger;
}

function ceiling(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** The job this call belongs to, or null outside one. */
export function currentJob(): JobBinding | null {
  const context = currentLogContext();
  const jobId = context?.jobId ?? context?.runId;
  if (jobId === undefined) return null;
  return {
    jobId,
    ...(context?.projectId === undefined ? {} : { projectId: context.projectId }),
    ...(context?.stage === undefined ? {} : { stage: context.stage }),
    ...(context?.agentId === undefined ? {} : { agentId: context.agentId }),
  };
}

export function priorPromptCalls(job: JobBinding | null, promptId: string): number {
  return job === null ? 0 : (ledgerFor(job.jobId).promptCalls.get(promptId) ?? 0);
}

/** Counts one `generate()` against its prompt, so a repeat can be recognised. */
export function notePromptCall(job: JobBinding | null, promptId: string): void {
  if (job === null) return;
  const { promptCalls } = ledgerFor(job.jobId);
  promptCalls.set(promptId, (promptCalls.get(promptId) ?? 0) + 1);
}

/**
 * Charges one provider call, refusing it past either ceiling.
 *
 * Non-retryable, because every retry and every failover provider would hit
 * the same ceiling; the job should fail now and say why.
 */
export function chargeProviderCall(job: JobBinding | null): void {
  if (job === null) return;
  const ledger = ledgerFor(job.jobId);
  const tokenCeiling = ceiling('AI_JOB_TOKEN_CEILING', DEFAULT_TOKEN_CEILING);
  const callCeiling = ceiling('AI_JOB_CALL_CEILING', DEFAULT_CALL_CEILING);
  if (ledger.tokens >= tokenCeiling) {
    throw new NonRetryableError(
      `This job used ${String(ledger.tokens)} model tokens, reaching its ceiling of ${String(tokenCeiling)} (AI_JOB_TOKEN_CEILING). Stopped to prevent a runaway loop.`,
    );
  }
  if (ledger.calls >= callCeiling) {
    throw new NonRetryableError(
      `This job made ${String(ledger.calls)} model calls, reaching its ceiling of ${String(callCeiling)} (AI_JOB_CALL_CEILING). Stopped to prevent a runaway loop.`,
    );
  }
  ledger.calls += 1;
}

export interface AnsweredCall {
  promptId: string;
  provider: ProviderId;
  model: string;
  usage: ModelUsage;
  costUsd: number | null;
  durationMs: number;
  /**
   * Counted toward the ceiling in place of a figure the provider left out, so
   * a provider that reports no usage cannot loop forever under the limit.
   */
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

/**
 * Records one call the provider answered, including an answer that later
 * failed validation: it was still billed. This is the only writer of model
 * usage for a job, so a call is one row however many layers report on it. A rejected or timed-out request is
 * not recorded, since no usage exists for it and a row would read as a call
 * whose usage merely went missing.
 *
 * The mock provider's counts are arithmetic on string lengths, not usage, so
 * they never reach the durable record.
 */
export function recordAnsweredCall(job: JobBinding | null, call: AnsweredCall): void {
  if (job === null) return;
  const missing = call.usage.unreported ?? [];
  const inputKnown = !missing.includes('input');
  const outputKnown = !missing.includes('output');

  ledgerFor(job.jobId).tokens +=
    (inputKnown ? call.usage.inputTokens : call.estimatedInputTokens) +
    (outputKnown ? call.usage.outputTokens : call.estimatedOutputTokens);

  if (job.projectId === undefined || call.provider === 'mock') return;
  void recordStageUsage({
    projectId: job.projectId,
    jobId: job.jobId,
    stage: job.stage ?? call.promptId,
    ...(job.agentId === undefined ? {} : { agentId: job.agentId }),
    provider: call.provider,
    model: call.model,
    inputTokens: inputKnown ? call.usage.inputTokens : null,
    outputTokens: outputKnown ? call.usage.outputTokens : null,
    costUsd: call.costUsd,
    durationMs: call.durationMs,
  });
}

/** Test-only: forget every job. */
export function resetJobLedgersForTests(): void {
  ledgers.clear();
}
