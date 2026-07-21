/**
 * Runs a named, multi-step workflow. Each step is either an `ai` step
 * (rendered from a prompt template and sent through the same `generate()`
 * pipeline `POST /ai/generate` uses) or a `pipeline-reference` step — a
 * deterministic Phase 2-8 stage the caller already ran itself, recorded
 * here only so the workflow's history/progress view is complete. The
 * generate function is injected rather than imported, so this file never
 * depends on the service module that depends on it.
 */
import { randomUUID } from 'node:crypto';

import type {
  GenerateRequest,
  GenerateResponse,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStepInput,
  WorkflowStepResult,
} from '../ai-orchestrator.types.js';

export type GenerateFn = (request: GenerateRequest) => Promise<GenerateResponse>;

export const FULL_PIPELINE_WORKFLOW: WorkflowDefinition = {
  id: 'full-pipeline',
  name: 'Full Generation Pipeline',
  description:
    'Requirement Analysis → Architecture → Database → Backend → Frontend → Security → Dependency Graph → Export',
  steps: [
    {
      name: 'requirement-analysis',
      kind: 'ai',
      promptId: 'requirement-analyzer',
      complexity: 'simple-extraction',
    },
    {
      name: 'architecture',
      kind: 'ai',
      promptId: 'architecture-planner',
      complexity: 'large-planning',
    },
    { name: 'database', kind: 'ai', promptId: 'database-generator', complexity: 'large-planning' },
    { name: 'backend', kind: 'ai', promptId: 'backend-generator', complexity: 'complex-refactor' },
    {
      name: 'frontend',
      kind: 'ai',
      promptId: 'frontend-generator',
      complexity: 'complex-refactor',
    },
    { name: 'security', kind: 'ai', promptId: 'security-engine', complexity: 'complex-refactor' },
    {
      name: 'dependency-graph',
      kind: 'ai',
      promptId: 'dependency-engine',
      complexity: 'small-file-regen',
    },
    { name: 'export', kind: 'pipeline-reference', pipelineModule: 'export' },
  ],
};

const WORKFLOWS = new Map<string, WorkflowDefinition>([
  [FULL_PIPELINE_WORKFLOW.id, FULL_PIPELINE_WORKFLOW],
]);

export function listWorkflows(): WorkflowDefinition[] {
  return [...WORKFLOWS.values()];
}

export function getWorkflow(id: string): WorkflowDefinition {
  const workflow = WORKFLOWS.get(id);
  if (!workflow)
    throw new Error(
      `Unknown workflow "${id}" — known workflows: ${[...WORKFLOWS.keys()].join(', ')}`,
    );
  return workflow;
}

async function runStep(
  step: WorkflowDefinition['steps'][number],
  input: WorkflowStepInput | undefined,
  generate: GenerateFn,
): Promise<WorkflowStepResult> {
  const startedAt = Date.now();

  if (step.kind === 'pipeline-reference') {
    return {
      name: step.name,
      kind: step.kind,
      status: input?.completed ? 'completed' : 'skipped',
      durationMs: Date.now() - startedAt,
    };
  }

  if (!input?.variables || !step.promptId) {
    return { name: step.name, kind: step.kind, status: 'skipped', durationMs: 0 };
  }

  try {
    const response = await generate({
      promptId: step.promptId,
      variables: input.variables,
      complexity: step.complexity ?? 'simple-extraction',
      context: input.context,
    });
    return {
      name: step.name,
      kind: step.kind,
      status: response.record.status === 'failed' ? 'failed' : 'completed',
      durationMs: Date.now() - startedAt,
      generationId: response.record.id,
      error: response.record.error,
    };
  } catch (error) {
    return {
      name: step.name,
      kind: step.kind,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Runs every step whose name appears in `inputs` (in workflow order) —
 * passing only some of a workflow's steps is exactly "allow individual
 * workflow execution": a caller can re-run just the `backend` step without
 * re-running the whole pipeline.
 */
export async function runWorkflow(
  workflow: WorkflowDefinition,
  inputs: WorkflowStepInput[],
  generate: GenerateFn,
): Promise<WorkflowRun> {
  const inputByName = new Map(inputs.map((i) => [i.name, i]));
  const startedAt = new Date().toISOString();
  const steps: WorkflowStepResult[] = [];

  for (const step of workflow.steps) {
    const input = inputByName.get(step.name);
    if (!input) {
      steps.push({ name: step.name, kind: step.kind, status: 'pending', durationMs: 0 });
      continue;
    }
    steps.push(await runStep(step, input, generate));
  }

  const hasFailure = steps.some((s) => s.status === 'failed');

  return {
    id: randomUUID(),
    workflowId: workflow.id,
    startedAt,
    completedAt: new Date().toISOString(),
    status: hasFailure ? 'failed' : 'completed',
    steps,
  };
}
