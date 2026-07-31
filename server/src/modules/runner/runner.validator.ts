/**
 * Input validation. File paths get a shallow shape check here; the real
 * traversal defense lives in `workspace-writer.ts`, which normalizes and
 * rejects escaping paths before any byte is written.
 */
import { body, query } from 'express-validator';
import type { ValidationChain } from 'express-validator';

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
