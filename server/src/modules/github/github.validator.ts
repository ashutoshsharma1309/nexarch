/**
 * Input validation. Repo/branch names are validated against GitHub's own
 * naming rules here so a typo fails locally in 422 with a field message
 * instead of round-tripping to the GitHub API for a worse error.
 */
import { body, param } from 'express-validator';
import type { ValidationChain } from 'express-validator';

import type {
  CreateBranchRequest,
  CreateRepoRequest,
  PushFile,
  PushProjectMeta,
  PushRequest,
} from './github.types.js';

/** GitHub repo names: alphanumerics, hyphen, underscore, dot; no leading dot. */
const REPO_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
/** Branch names — the practical subset (no spaces, no control chars, no leading dash). */
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export const createRepoValidation: ValidationChain[] = [
  body('name')
    .isString()
    .trim()
    .matches(REPO_NAME_PATTERN)
    .withMessage('name must be a valid GitHub repository name'),
  body('description').optional().isString().withMessage('description must be a string'),
  body('private').isBoolean().withMessage('private is required (true or false)'),
];

export const repoParamsValidation: ValidationChain[] = [
  param('owner').isString().trim().isLength({ min: 1 }).withMessage('owner is required'),
  param('repo')
    .isString()
    .trim()
    .matches(REPO_NAME_PATTERN)
    .withMessage('repo must be a valid GitHub repository name'),
];

export const createBranchValidation: ValidationChain[] = [
  body('owner').isString().trim().isLength({ min: 1 }).withMessage('owner is required'),
  body('repo')
    .isString()
    .trim()
    .matches(REPO_NAME_PATTERN)
    .withMessage('repo must be a valid GitHub repository name'),
  body('branch')
    .isString()
    .trim()
    .matches(BRANCH_NAME_PATTERN)
    .withMessage('branch must be a valid git branch name'),
  body('fromBranch')
    .optional()
    .isString()
    .trim()
    .matches(BRANCH_NAME_PATTERN)
    .withMessage('fromBranch must be a valid git branch name'),
];

export const pushValidation: ValidationChain[] = [
  body('owner').isString().trim().isLength({ min: 1 }).withMessage('owner is required'),
  body('repo')
    .isString()
    .trim()
    .matches(REPO_NAME_PATTERN)
    .withMessage('repo must be a valid GitHub repository name'),
  body('branch')
    .isString()
    .trim()
    .matches(BRANCH_NAME_PATTERN)
    .withMessage('branch must be a valid git branch name'),
  body('message')
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('message is required (1-500 characters)'),
  body('files').isArray({ min: 1 }).withMessage('files must be a non-empty array'),
  body('files.*.path')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('every file needs a path'),
  body('files.*.content').isString().withMessage('every file needs string content'),
  body('generateReadme').isBoolean().withMessage('generateReadme is required (true or false)'),
  body('projectMeta').optional().isObject().withMessage('projectMeta must be an object'),
];

export function readCreateRepoRequest(payload: Record<string, unknown>): CreateRepoRequest {
  return {
    name: payload.name as string,
    description: payload.description as string | undefined,
    private: payload.private as boolean,
  };
}

export function readCreateBranchRequest(payload: Record<string, unknown>): CreateBranchRequest {
  return {
    owner: payload.owner as string,
    repo: payload.repo as string,
    branch: payload.branch as string,
    fromBranch: payload.fromBranch as string | undefined,
  };
}

export function readPushRequest(payload: Record<string, unknown>): PushRequest {
  return {
    owner: payload.owner as string,
    repo: payload.repo as string,
    branch: payload.branch as string,
    message: payload.message as string,
    files: payload.files as PushFile[],
    generateReadme: payload.generateReadme as boolean,
    projectMeta: payload.projectMeta as PushProjectMeta | undefined,
  };
}
