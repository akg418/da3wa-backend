import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { authenticate } from '../../middleware/authenticate';
import {
  authSuccessResponse,
  commonErrorResponses,
  errorResponse,
  messageSuccessResponse,
  redirectResponse,
  unauthorizedResponse,
  userSuccessResponse,
  validationErrorResponse,
} from '../../schemas/api.schemas';
import { ErrorCode } from '../../utils/errors';
import {
  googleAuthHandler,
  googleCallbackHandler,
  logoutHandler,
  meHandler,
  signinHandler,
  signupHandler,
} from './auth.controller';
import {
  googleCallbackQuerySchema,
  signinSchema,
  signupSchema,
  type GoogleCallbackQuery,
  type SigninInput,
  type SignupInput,
} from './auth.schemas';

const bearerAuth = [{ bearerAuth: [] }];
const noAuth: [] = [];

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
  });

  fastify.post<{ Body: SignupInput }>(
    '/signup',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Register a new account',
        description:
          'Creates a local account from a username and password and immediately returns an access token, so no separate sign-in call is needed. The password is hashed with Argon2id and is never returned.',
        operationId: 'signup',
        security: noAuth,
        body: signupSchema,
        response: {
          201: authSuccessResponse,
          400: validationErrorResponse,
          409: errorResponse('The username is already taken.', {
            code: ErrorCode.CONFLICT,
            message: 'Username is already taken',
          }),
          ...commonErrorResponses,
        },
      },
    },
    signupHandler,
  );

  fastify.post<{ Body: SigninInput }>(
    '/signin',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Sign in with username and password',
        description:
          'Verifies the credentials and returns a fresh access token. The username is matched case-insensitively. An unknown username and a wrong password produce the same generic 401, so the endpoint cannot be used to enumerate accounts.',
        operationId: 'signin',
        security: noAuth,
        body: signinSchema,
        response: {
          200: authSuccessResponse,
          400: validationErrorResponse,
          401: errorResponse('Unknown username or wrong password.', {
            code: ErrorCode.UNAUTHORIZED,
            message: 'Invalid credentials',
          }),
          ...commonErrorResponses,
        },
      },
    },
    signinHandler,
  );

  fastify.get(
    '/google',
    {
      schema: {
        tags: ['Google OAuth'],
        summary: 'Start the Google sign-in flow',
        description:
          'Generates a random `state`, stores it in a signed, httpOnly, 10-minute `oauth_state` cookie, and redirects the browser to Google. Open this URL in a browser (`window.location.href = ...`) rather than fetching it with XHR — "Try it out" here will only show the redirect.',
        operationId: 'googleAuthStart',
        security: noAuth,
        response: {
          302: redirectResponse.meta({
            description: "Redirect to Google's consent screen.",
          }),
          ...commonErrorResponses,
        },
      },
    },
    googleAuthHandler,
  );

  fastify.get<{ Querystring: GoogleCallbackQuery }>(
    '/google/callback',
    {
      schema: {
        tags: ['Google OAuth'],
        summary: 'Google OAuth callback',
        description:
          'Called by Google, not by your client. Verifies `state` against the signed cookie, exchanges the code for an ID token, validates it, then finds or creates the user — a Google account whose email matches an existing local account is linked to it. Finally redirects to `FRONTEND_URL + FRONTEND_AUTH_CALLBACK_PATH` with the token in the URL **fragment** (`#access_token=...&token_type=Bearer&expires_in=3600`), because fragments are never sent to a server and so stay out of access logs and `Referer` headers.',
        operationId: 'googleAuthCallback',
        security: noAuth,
        querystring: googleCallbackQuerySchema,
        response: {
          302: redirectResponse.meta({
            description:
              'Redirect to the frontend callback page, with the access token in the URL fragment.',
          }),
          401: errorResponse(
            'The `state` did not match the cookie, the user declined consent, or Google rejected the code.',
            { code: ErrorCode.OAUTH_ERROR, message: 'Invalid OAuth state' },
          ),
          ...commonErrorResponses,
        },
      },
    },
    googleCallbackHandler,
  );

  fastify.get(
    '/me',
    {
      // preHandler, not onRequest: @fastify/rate-limit appends its own onRequest
      // hook after route-level ones, so authenticating there would let an
      // unauthenticated caller bypass the rate limit entirely.
      preHandler: authenticate,
      schema: {
        tags: ['Session'],
        summary: 'Get the current user',
        description:
          'Returns the profile of the account the bearer token belongs to. Use it to restore session state after a page reload or after the Google callback.',
        operationId: 'getCurrentUser',
        security: bearerAuth,
        response: {
          200: userSuccessResponse,
          401: unauthorizedResponse,
          ...commonErrorResponses,
        },
      },
    },
    meHandler,
  );

  fastify.post(
    '/logout',
    {
      // preHandler, not onRequest: @fastify/rate-limit appends its own onRequest
      // hook after route-level ones, so authenticating there would let an
      // unauthenticated caller bypass the rate limit entirely.
      preHandler: authenticate,
      schema: {
        tags: ['Session'],
        summary: 'Log out',
        description:
          'Access tokens are stateless, so nothing is revoked server-side — this endpoint only confirms the token was valid and tells the client to discard it. For real revocation you would need refresh tokens with a server-side store.',
        operationId: 'logout',
        security: bearerAuth,
        response: {
          200: messageSuccessResponse,
          401: unauthorizedResponse,
          ...commonErrorResponses,
        },
      },
    },
    logoutHandler,
  );
}
