/**
 * Input rules for the credential endpoints. The password floor is a real
 * floor (length plus mixed character classes) rather than decoration — this
 * is the only place the platform can enforce it, because everything
 * downstream sees a hash.
 */
import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';

const emailChain = (): ValidationChain =>
  body('email')
    .exists({ values: 'falsy' })
    .withMessage('Email is required')
    .bail()
    .isString()
    .bail()
    .trim()
    .toLowerCase()
    .isEmail()
    .withMessage('Enter a valid email address')
    .bail()
    .isLength({ max: 320 })
    .withMessage('Email is too long');

export const registerValidation: ValidationChain[] = [
  body('name')
    .exists({ values: 'falsy' })
    .withMessage('Name is required')
    .bail()
    .isString()
    .bail()
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('Name must be 2–120 characters'),
  emailChain(),
  body('password')
    .exists({ values: 'falsy' })
    .withMessage('Password is required')
    .bail()
    .isString()
    .bail()
    .isLength({ min: 10, max: 200 })
    .withMessage('Password must be at least 10 characters')
    .bail()
    .matches(/[a-z]/)
    .withMessage('Password must contain a lowercase letter')
    .bail()
    .matches(/[A-Z]/)
    .withMessage('Password must contain an uppercase letter')
    .bail()
    .matches(/[0-9]/)
    .withMessage('Password must contain a digit'),
];

export const loginValidation: ValidationChain[] = [
  emailChain(),
  body('password')
    .exists({ values: 'falsy' })
    .withMessage('Password is required')
    .bail()
    .isString(),
];
