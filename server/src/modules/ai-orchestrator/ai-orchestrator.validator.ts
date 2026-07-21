/**
 * Input validation for Phase 9's four endpoints. `promptId` is checked
 * against the real templates on disk (via the prompt engine), not a
 * hardcoded list — a template gets added, the validator already accepts
 * it.
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import { listPromptTemplates } from './lib/prompt-engine.js';
import type { GenerateRequest, WorkflowStepInput } from './ai-orchestrator.types.js';

const TASK_COMPLEXITIES = [
  'simple-extraction',
  'large-planning',
  'small-file-regen',
  'complex-refactor',
];
const RESPONSE_SCHEMAS = [
  'requirement-spec',
  'architecture-plan',
  'database-design',
  'generic-json',
];

function knownPromptIds(): string[] {
  return listPromptTemplates().map((t) => t.id);
}

export const generateValidation: ValidationChain[] = [
  body('promptId')
    .isString()
    .custom((value: string) => {
      if (!knownPromptIds().includes(value)) {
        throw new Error(`promptId must be one of: ${knownPromptIds().join(', ')}`);
      }
      return true;
    }),
  body('variables')
    .isObject()
    .withMessage('variables must be an object of {{PLACEHOLDER}} -> value'),
  body('complexity')
    .isIn(TASK_COMPLEXITIES)
    .withMessage(`complexity must be one of: ${TASK_COMPLEXITIES.join(', ')}`),
  body('schema')
    .optional()
    .isIn(RESPONSE_SCHEMAS)
    .withMessage(`schema must be one of: ${RESPONSE_SCHEMAS.join(', ')}`),
  body('context').optional().isObject().withMessage('context must be an object'),
];

export const workflowValidation: ValidationChain[] = [
  body('workflowId').isString().withMessage('workflowId is required'),
  body('steps').isArray().withMessage('steps must be an array'),
  body('steps.*.name').isString().withMessage('each step needs a name'),
];

export function readGenerateRequest(body: Record<string, unknown>): GenerateRequest {
  return {
    promptId: body.promptId as string,
    variables: (body.variables as GenerateRequest['variables'] | undefined) ?? {},
    complexity: body.complexity as GenerateRequest['complexity'],
    context: body.context as GenerateRequest['context'],
    schema: body.schema as GenerateRequest['schema'],
  };
}

export function readWorkflowRequest(body: Record<string, unknown>): {
  workflowId: string;
  steps: WorkflowStepInput[];
} {
  return {
    workflowId: body.workflowId as string,
    steps: (body.steps as WorkflowStepInput[] | undefined) ?? [],
  };
}
