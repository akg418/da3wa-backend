import { z } from 'zod';

/**
 * Username rules:
 * - 3-30 characters
 * - letters, numbers and underscores only
 * - must NOT start with a number
 * Stored lowercase so lookups are case-insensitive.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be at most 30 characters')
  .regex(
    /^[a-zA-Z0-9_]+$/,
    'Username may only contain letters, numbers, and underscores',
  )
  .regex(/^[^0-9]/, 'Username cannot start with a number')
  .transform((value) => value.toLowerCase())
  .meta({
    description:
      '3-30 characters, letters/numbers/underscores only, and it must not start with a number. Stored lowercase, so sign-in is case-insensitive.',
    // The two `.regex()` checks above are emitted as an `allOf`, which Swagger UI
    // only half-renders. This equivalent single pattern makes the rendered rule
    // complete for readers.
    pattern: '^[a-zA-Z_][a-zA-Z0-9_]{2,29}$',
    examples: ['alice_99'],
  });

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .meta({
    description: 'At least 8 characters, including at least one letter and one number.',
    examples: ['password1'],
  });

export const signupSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
  })
  .meta({ description: 'Credentials for a new local account.' });

export const signinSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1, 'Username is required')
      .transform((value) => value.toLowerCase())
      .meta({ description: 'Case-insensitive.', examples: ['alice_99'] }),
    password: z.string().min(1, 'Password is required').meta({ examples: ['password1'] }),
  })
  .meta({ description: 'Credentials for an existing local account.' });

/** Query string Google appends when redirecting back to the callback URL. */
export const googleCallbackQuerySchema = z.object({
  code: z.string().optional().meta({
    description: 'One-time authorization code issued by Google. Present on success.',
  }),
  state: z.string().optional().meta({
    description:
      'Opaque value echoed back by Google. Must match the signed `oauth_state` cookie set when the flow started.',
  }),
  error: z.string().optional().meta({
    description:
      'Set instead of `code` when the user declines consent, e.g. `access_denied`. Answered with 401 OAUTH_ERROR.',
    examples: ['access_denied'],
  }),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type SigninInput = z.infer<typeof signinSchema>;
export type GoogleCallbackQuery = z.infer<typeof googleCallbackQuerySchema>;

export interface UserResponse {
  id: string;
  username: string;
  /** Absent on accounts created with a username and password. */
  email?: string;
  authProviders: string[];
}
