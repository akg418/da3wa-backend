import type { FastifyReply } from 'fastify';
import { env } from '../../config/env';

/**
 * The API is Bearer-token based, so no session cookie is ever set. The only
 * cookie used is the short-lived, signed OAuth `state` cookie that protects
 * the Google authorization-code flow against CSRF.
 */
export const OAUTH_STATE_COOKIE = 'oauth_state';

const OAUTH_STATE_MAX_AGE_SECONDS = 600;

export function setOAuthStateCookie(reply: FastifyReply, state: string): void {
  reply.setCookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path: '/',
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    signed: true,
  });
}

export function clearOAuthStateCookie(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_STATE_COOKIE, {
    path: '/',
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
  });
}
