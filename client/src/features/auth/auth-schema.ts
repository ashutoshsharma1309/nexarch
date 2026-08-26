import { z } from 'zod';

/**
 * The client half of the credential contract. The password rules mirror
 * `server/src/modules/auth/auth.validator.ts` exactly — the server is still
 * the authority, but a user should learn a password is too short before
 * they hit send, not after.
 */
export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120, 'Name is too long'),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(200, 'Password is too long')
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a digit'),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
