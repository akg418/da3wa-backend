import { z } from 'zod';
import { ErrorCode } from '../utils/errors';

/**
 * Shared response shapes. These Zod schemas are the single source of truth:
 * Fastify serializes responses with them and @fastify/swagger derives the
 * OpenAPI document from them, so the docs cannot drift from the API.
 */

const errorDetailSchema = z.object({
  field: z.string().meta({
    description: 'Dotted path of the offending field.',
    examples: ['username'],
  }),
  message: z.string().meta({
    description: 'What is wrong with that field.',
    examples: ['Username cannot start with a number'],
  }),
});

export const errorBodySchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.enum(ErrorCode).meta({
      description: 'Stable, machine-readable error code.',
    }),
    message: z.string().meta({
      description: 'Human-readable explanation.',
    }),
    details: z.array(errorDetailSchema).optional().meta({
      description: 'Per-field failures. Only present for VALIDATION_ERROR.',
    }),
  }),
});

export interface ErrorExample {
  code: ErrorCode;
  message: string;
  details?: { field: string; message: string }[];
}

/**
 * Documents one error status code. The `code` property stays a full enum in the
 * schema (a single status can carry more than one code — 401 is UNAUTHORIZED or
 * OAUTH_ERROR) while `example` shows the case callers will actually hit.
 */
export function errorResponse(description: string, example: ErrorExample) {
  return errorBodySchema.meta({
    description,
    examples: [{ success: false, error: example }],
  });
}

export const validationErrorResponse = errorResponse(
  'The request body or query string failed validation. `details` lists every offending field.',
  {
    code: ErrorCode.VALIDATION_ERROR,
    message: 'Validation failed',
    details: [{ field: 'username', message: 'Username cannot start with a number' }],
  },
);

export const unauthorizedResponse = errorResponse(
  'The `Authorization` header is missing, malformed, or carries an invalid/expired token.',
  {
    code: ErrorCode.UNAUTHORIZED,
    message: 'Missing Authorization header. Send "Authorization: Bearer <accessToken>".',
  },
);

export const rateLimitedResponse = errorResponse(
  'Rate limit exceeded — auth routes allow 10 requests per minute per IP. See the `retry-after` response header.',
  { code: ErrorCode.TOO_MANY_REQUESTS, message: 'Rate limit exceeded, retry in 1 minute' },
);

export const internalErrorResponse = errorResponse('Unexpected server error.', {
  code: ErrorCode.INTERNAL_ERROR,
  message: 'Internal server error',
});

export const notFoundResponse = errorResponse('No route matches this method and path.', {
  code: ErrorCode.NOT_FOUND,
  message: 'Route GET /api/v1/nope not found',
});

/** Error responses every route can produce. */
export const commonErrorResponses = {
  429: rateLimitedResponse,
  500: internalErrorResponse,
};

export const userSchema = z.object({
  id: z.string().meta({
    description: 'MongoDB ObjectId of the user.',
    examples: ['6a9ad9288c047ed0a05e2d83'],
  }),
  username: z.string().optional().meta({
    description: 'Lowercased username. Absent for accounts created through Google.',
    examples: ['alice_99'],
  }),
  email: z.string().optional().meta({
    description: 'Email address. Only set for accounts that signed in with Google.',
    examples: ['alice@example.com'],
  }),
  displayName: z.string().optional().meta({
    description: 'Full name supplied by Google.',
    examples: ['Alice Smith'],
  }),
  avatarUrl: z.string().optional().meta({
    description: 'Profile picture supplied by Google.',
  }),
  authProviders: z.array(z.enum(['local', 'google'])).meta({
    description:
      'Every sign-in method linked to this account. Contains both entries once a Google login is matched to an existing account by email.',
    examples: [['local']],
  }),
});

export const authSuccessResponse = z
  .object({
    success: z.literal(true),
    data: z.object({
      accessToken: z.string().meta({
        description:
          'Signed JWT. Send it on every protected request as `Authorization: Bearer <accessToken>`.',
        examples: ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2YTlhZDkyOD...'],
      }),
      tokenType: z.literal('Bearer'),
      expiresIn: z.int().meta({
        description: 'Token lifetime in seconds, derived from the JWT_EXPIRES_IN setting.',
        examples: [3600],
      }),
      user: userSchema,
    }),
  })
  .meta({ description: 'Authentication succeeded. The access token is in `data.accessToken`.' });

export const userSuccessResponse = z
  .object({
    success: z.literal(true),
    data: z.object({ user: userSchema }),
  })
  .meta({ description: 'The profile of the authenticated user.' });

export const messageSuccessResponse = z
  .object({
    success: z.literal(true),
    data: z.object({
      message: z.string().meta({ examples: ['Logged out. Discard the stored access token.'] }),
    }),
  })
  .meta({ description: 'Acknowledgement.' });

export const redirectResponse = z
  .null()
  .meta({ description: 'Redirect. Follow the `Location` response header.' });

const healthDataSchema = z.object({
  status: z.enum(['ok', 'degraded']).meta({
    description: '`ok` when the database is reachable, `degraded` otherwise.',
  }),
  database: z.enum(['connected', 'disconnected']).meta({
    description: 'Result of a `ping` against MongoDB.',
  }),
});

export const healthOkResponse = z
  .object({ success: z.literal(true), data: healthDataSchema })
  .meta({ description: 'The service and its database are healthy.' });

export const healthDegradedResponse = z
  .object({ success: z.literal(false), data: healthDataSchema })
  .meta({
    description: 'The service is up but MongoDB is unreachable. Useful as a readiness probe.',
  });
