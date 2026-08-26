/**
 * The only user-authored input the whole platform takes is this prompt, so
 * this is where "invalid user prompt" gets turned into a useful sentence
 * rather than a stage failure five seconds later.
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

export const PROMPT_MIN_LENGTH = 15;
export const PROMPT_MAX_LENGTH = 2000;

export const startRunValidation: ValidationChain[] = [
  body('prompt')
    .exists({ values: 'falsy' })
    .withMessage('Describe the application you want built')
    .bail()
    .isString()
    .withMessage('The prompt must be text')
    .bail()
    .trim()
    .isLength({ min: PROMPT_MIN_LENGTH })
    .withMessage(`Add a little more detail — at least ${PROMPT_MIN_LENGTH} characters`)
    .bail()
    .isLength({ max: PROMPT_MAX_LENGTH })
    .withMessage(`Keep the description under ${PROMPT_MAX_LENGTH} characters`)
    .bail()
    .custom((value: string) => /[a-zA-Z]{3}/.test(value))
    .withMessage('That does not look like a description of an application'),
  body('projectName')
    .optional({ values: 'falsy' })
    .isString()
    .bail()
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('Project name must be 2–120 characters'),
];
