import { z } from 'zod';

/**
 * Validation for the forge form. This schema is the client half of a
 * contract: when the generation endpoint ships in Phase 2, the server
 * validates the same bounds and the two are kept in lockstep.
 */
export const forgeDraftSchema = z.object({
  projectName: z
    .string()
    .max(60, 'Keep the name under 60 characters')
    .refine(
      (value) => value === '' || /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(value),
      'Use letters, numbers, spaces, dashes or underscores',
    ),
  prompt: z
    .string()
    .trim()
    .min(20, 'Describe the application in at least 20 characters')
    .max(4000, 'Keep the description under 4,000 characters'),
});

export type ForgeDraft = z.infer<typeof forgeDraftSchema>;

export const PROMPT_MAX_LENGTH = 4000;
