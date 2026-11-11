/**
 * Input validation. File paths get a shallow shape check here; the real
 * traversal defense lives in `workspace-writer.ts`, which normalizes and
 * rejects escaping paths before any byte is written.
 */
import { body, query } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type { RunSelection } from './lib/owned-project-files.js';
import type { CreateSessionRequest, RunnerFile } from './runner.types.js';

export const createSessionValidation: ValidationChain[] = [
  body('projectName')
    .isString()
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('projectName is required (1-120 characters)'),
  body('files').isArray({ min: 1 }).withMessage('files must be a non-empty array'),
  body('files.*.path')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('every file needs a path'),
  body('files.*.content').isString().withMessage('every file needs string content'),
  body('env').optional().isObject().withMessage('env must be a string map'),
];

/**
 * A run names a stored generation: by project, or by the files the preview
 * page holds. Either way only what the server has stored is executed.
 */
export const runSelectionValidation: ValidationChain[] = [
  body('projectId').optional().isString().trim().isLength({ min: 1, max: 64 }),
  body('runId').optional().isString().trim().isLength({ min: 1, max: 64 }),
  body('projectName')
    .if(body('projectId').not().exists())
    .isString()
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('projectName is required (1-120 characters)'),
  body('files')
    .if(body('projectId').not().exists())
    .isArray({ min: 1 })
    .withMessage('files must be a non-empty array'),
  body('files.*.path').optional().isString().isLength({ min: 1 }),
  body('files.*.content').optional().isString(),
];

export const logsValidation: ValidationChain[] = [
  query('after').optional().isInt({ min: 0 }).withMessage('after must be a non-negative integer'),
];

export function readCreateSessionRequest(payload: Record<string, unknown>): CreateSessionRequest {
  return {
    projectName: payload.projectName as string,
    files: payload.files as RunnerFile[],
    env: payload.env as Record<string, string> | undefined,
  };
}

export function readRunSelection(payload: Record<string, unknown>): RunSelection {
  return {
    projectId: payload.projectId as string | undefined,
    runId: payload.runId as string | undefined,
    projectName: payload.projectName as string | undefined,
    files: payload.files as RunnerFile[] | undefined,
  };
}
