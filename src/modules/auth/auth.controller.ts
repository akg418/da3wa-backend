import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env';
import {
  clearOAuthStateCookie,
  OAUTH_STATE_COOKIE,
  setOAuthStateCookie,
} from './auth.cookies';
import type { GoogleCallbackQuery, SigninInput, SignupInput } from './auth.schemas';
import {
  findOrCreateGoogleUser,
  getUserById,
  signIn,
  signUp,
  toUserResponse,
} from './auth.service';
import { issueAccessToken } from './auth.token';
import {
  exchangeGoogleCode,
  generateOAuthState,
  getGoogleAuthorizationUrl,
} from './google-oauth.service';
import { AppError, ErrorCode } from '../../utils/errors';

// Request bodies and query strings are validated (and lowercased/trimmed) by the
// route's Zod schema before a handler runs, so they arrive already parsed.

export async function signupHandler(
  request: FastifyRequest<{ Body: SignupInput }>,
  reply: FastifyReply,
): Promise<void> {
  const user = await signUp(request.body);
  const token = await issueAccessToken(reply, user);

  reply.status(201).send({
    success: true,
    data: { ...token, user: toUserResponse(user) },
  });
}

export async function signinHandler(
  request: FastifyRequest<{ Body: SigninInput }>,
  reply: FastifyReply,
): Promise<void> {
  const user = await signIn(request.body);
  const token = await issueAccessToken(reply, user);

  reply.send({
    success: true,
    data: { ...token, user: toUserResponse(user) },
  });
}

export async function logoutHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Access tokens are stateless, so there is nothing to revoke server-side.
  // The client must discard the token it is holding.
  reply.send({
    success: true,
    data: { message: 'Logged out. Discard the stored access token.' },
  });
}

export async function meHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = await getUserById(request.user.sub);
  if (!user) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Not authenticated', 401);
  }
  reply.send({ success: true, data: { user: toUserResponse(user) } });
}

export async function googleAuthHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const state = generateOAuthState();
  setOAuthStateCookie(reply, state);
  reply.redirect(getGoogleAuthorizationUrl(state));
}

export async function googleCallbackHandler(
  request: FastifyRequest<{ Querystring: GoogleCallbackQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const { code, state, error } = request.query;

  if (error) {
    clearOAuthStateCookie(reply);
    throw new AppError(
      ErrorCode.OAUTH_ERROR,
      `Google authentication failed: ${error}`,
      401,
    );
  }

  if (!code || !state) {
    throw new AppError(ErrorCode.OAUTH_ERROR, 'Google authentication failed', 401);
  }

  const storedState = request.unsignCookie(request.cookies[OAUTH_STATE_COOKIE] ?? '');
  clearOAuthStateCookie(reply);

  if (!storedState.valid || storedState.value !== state) {
    throw new AppError(ErrorCode.OAUTH_ERROR, 'Invalid OAuth state', 401);
  }

  const profile = await exchangeGoogleCode(code);
  const user = await findOrCreateGoogleUser(profile);
  const token = await issueAccessToken(reply, user);

  // The token is handed to the SPA in the URL fragment: fragments are never
  // sent to a server, so it stays out of access logs and Referer headers.
  const fragment = new URLSearchParams({
    access_token: token.accessToken,
    token_type: token.tokenType,
    expires_in: String(token.expiresIn),
  });

  reply.redirect(
    `${env.FRONTEND_URL}${env.FRONTEND_AUTH_CALLBACK_PATH}#${fragment.toString()}`,
  );
}
