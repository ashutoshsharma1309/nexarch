/**
 * The enhancement workflow with its real dependencies bound.
 *
 * Request, project context, impact, optional research and a plan come first
 * and change nothing. Applying then implements only the planned files in a
 * private copy, builds and exercises it, and stores it only if it passed.
 */
import type { EditJob } from '../project-editor/lib/edit-job-store.js';
import { defaultEnhancementDeps } from './enhancement.deps.js';
import type { EnhancementPlan } from './enhancement.types.js';
import * as lifecycle from './lib/orchestrator.js';

export function planEnhancement(input: {
  projectId: string;
  ownerId: string;
  instruction: string;
  research?: boolean;
  referenceUrls?: readonly string[];
}): Promise<EnhancementPlan> {
  return lifecycle.planEnhancement(input, defaultEnhancementDeps);
}

export function applyEnhancement(input: {
  projectId: string;
  ownerId: string;
  planId: string;
}): Promise<EditJob> {
  return lifecycle.applyEnhancement(input, defaultEnhancementDeps);
}

export function cancelEnhancement(input: {
  projectId: string;
  ownerId: string;
  jobId: string;
}): Promise<EditJob> {
  return lifecycle.cancelEnhancement(input, defaultEnhancementDeps);
}

export function revertEnhancement(input: {
  projectId: string;
  ownerId: string;
  jobId: string;
}): Promise<{ runId: string; restoredRunId: string }> {
  return lifecycle.revertEnhancement(input, defaultEnhancementDeps);
}

export function getEnhancementJob(input: {
  projectId: string;
  ownerId: string;
  jobId: string;
}): Promise<EditJob> {
  return lifecycle.getEnhancementJob(input, defaultEnhancementDeps);
}

export function currentEnhancementJob(input: {
  projectId: string;
  ownerId: string;
}): Promise<EditJob | null> {
  return lifecycle.currentEnhancementJob(input, defaultEnhancementDeps);
}
