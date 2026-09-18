/**
 * Builder Agent sessions: start one from a task, watch it, cancel it.
 *
 * Sessions live in process memory, like pipeline runs and runner sessions —
 * what they build (projects, the engineering graph) is persisted by the
 * systems the tools delegate to. Each owner may run one session at a time: a
 * session installs and starts a whole application, and two at once is what
 * pushes a small machine into swap.
 */
import { randomUUID } from 'node:crypto';

import { logger } from '../../shared/logger/index.js';
import { AppError } from '../../shared/utils/app-error.js';
import type { BuilderSession, StartBuilderInput } from './builder-agent.types.js';
import { decideWithModel, modelAvailable } from './lib/decider.js';
import { runLoop } from './lib/loop.js';
import { runTool, toolByName } from './lib/tools.js';

interface Entry {
  session: BuilderSession;
  ownerId: string;
  cancelled: boolean;
}

const MAX_KEPT = 20;
const entries = new Map<string, Entry>();

function trim(): void {
  if (entries.size <= MAX_KEPT) return;
  for (const [id, entry] of entries) {
    if (entry.session.status !== 'running') {
      entries.delete(id);
      if (entries.size <= MAX_KEPT) return;
    }
  }
}

function owned(id: string, ownerId: string): Entry {
  const entry = entries.get(id);
  // Someone else's session reads as missing, never as forbidden.
  if (entry?.ownerId === ownerId) return entry;
  throw AppError.notFound('Builder session not found');
}

export function startSession(ownerId: string, input: StartBuilderInput): BuilderSession {
  const running = [...entries.values()].find(
    (entry) => entry.ownerId === ownerId && entry.session.status === 'running',
  );
  if (running) {
    throw AppError.conflict('A builder session is already running — wait for it or cancel it');
  }

  const createdAt = new Date().toISOString();
  const session: BuilderSession = {
    id: randomUUID(),
    task: input.task.trim(),
    status: 'running',
    plan: [],
    steps: [],
    state: {
      projectId: null,
      projectName: null,
      pipelineRunId: null,
      agentRunId: null,
      previewSessionId: null,
      frontendUrl: null,
      backendUrl: null,
      validationGate: null,
      repaired: false,
      inspected: false,
      buildDegraded: null,
      landingSections: [],
    },
    result: null,
    error: null,
    usage: {
      decisions: 0,
      modelDecisions: 0,
      policyDecisions: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    },
    createdAt,
    updatedAt: createdAt,
  };
  const entry: Entry = { session, ownerId, cancelled: false };
  entries.set(session.id, entry);
  trim();

  logger.info('builder agent session started', {
    sessionId: session.id,
    model: modelAvailable() ? 'configured' : 'none — policy only',
  });

  // Detached: the request answers now, the session advances in the background.
  void runLoop(session, {
    decide: modelAvailable() ? decideWithModel : null,
    tool: toolByName,
    runTool,
    ownerId,
    isCancelled: () => entry.cancelled,
  }).then(() => {
    logger.info('builder agent session settled', {
      sessionId: session.id,
      status: session.status,
      decisions: session.usage.decisions,
      byModel: session.usage.modelDecisions,
    });
  });

  return session;
}

export function getSession(id: string, ownerId: string): BuilderSession {
  return owned(id, ownerId).session;
}

export function listSessions(ownerId: string): BuilderSession[] {
  return [...entries.values()]
    .filter((entry) => entry.ownerId === ownerId)
    .map((entry) => entry.session)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function cancelSession(id: string, ownerId: string): BuilderSession {
  const entry = owned(id, ownerId);
  if (entry.session.status !== 'running') {
    throw AppError.conflict(`Session is ${entry.session.status} — nothing to cancel`);
  }
  entry.cancelled = true;
  return entry.session;
}
