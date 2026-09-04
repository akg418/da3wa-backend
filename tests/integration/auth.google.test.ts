import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { User } from '../../src/models/user.model';
import {
  bearer,
  parseSetCookies,
  setupTestDatabase,
  teardownTestDatabase,
} from '../helpers/setup';

vi.mock('../../src/modules/auth/google-oauth.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/modules/auth/google-oauth.service')>();
  return {
    ...actual,
    exchangeGoogleCode: vi.fn(),
    getGoogleAuthorizationUrl: vi.fn(
      (state: string) => `https://accounts.google.com/o/oauth2?state=${state}`,
    ),
  };
});

import * as googleOAuth from '../../src/modules/auth/google-oauth.service';

describe('google oauth integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    await setupTestDatabase();
    app = await buildApp();
    vi.mocked(googleOAuth.exchangeGoogleCode).mockReset();
  });

  afterEach(async () => {
    await app.close();
    await teardownTestDatabase();
  });

  async function startFlow() {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/google' });
    const cookies = parseSetCookies(res.headers['set-cookie']);
    const state = new URL(res.headers.location ?? '').searchParams.get('state');
    return { cookies, state };
  }

  it('redirects to the google authorization url with a state cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/google' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
    expect(parseSetCookies(response.headers['set-cookie']).oauth_state).toBeDefined();
  });

  it('creates a user and returns the token in the redirect fragment', async () => {
    vi.mocked(googleOAuth.exchangeGoogleCode).mockResolvedValue({
      googleId: 'google-new',
      email: 'new@example.com',
      displayName: 'New User',
      avatarUrl: 'https://example.com/avatar.png',
    });

    const { cookies, state } = await startFlow();
    expect(state).toBeTruthy();

    const callbackRes = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=auth-code&state=${encodeURIComponent(state!)}`,
      cookies,
    });

    expect(callbackRes.statusCode).toBe(302);
    const location = new URL(callbackRes.headers.location ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(
      `${env.FRONTEND_URL}${env.FRONTEND_AUTH_CALLBACK_PATH}`,
    );

    // Token travels in the fragment, never in the query string.
    expect(location.search).toBe('');
    const fragment = new URLSearchParams(location.hash.slice(1));
    const accessToken = fragment.get('access_token');
    expect(accessToken).toBeTruthy();
    expect(fragment.get('token_type')).toBe('Bearer');
    expect(fragment.get('expires_in')).toBe('3600');

    const user = await User.findOne({ googleId: 'google-new' });
    expect(user?.email).toBe('new@example.com');
    expect(user?.authProviders).toContain('google');

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(accessToken!),
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().data.user.email).toBe('new@example.com');
  });

  it('links google to an existing local user by email', async () => {
    await User.create({
      username: 'localuser',
      email: 'link@example.com',
      passwordHash: 'hash',
      authProviders: ['local'],
    });

    vi.mocked(googleOAuth.exchangeGoogleCode).mockResolvedValue({
      googleId: 'google-link',
      email: 'link@example.com',
      displayName: 'Linked User',
    });

    const { cookies, state } = await startFlow();
    await app.inject({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=auth-code&state=${encodeURIComponent(state!)}`,
      cookies,
    });

    const user = await User.findOne({ email: 'link@example.com' });
    expect(user?.googleId).toBe('google-link');
    expect(user?.authProviders).toContain('local');
    expect(user?.authProviders).toContain('google');
  });

  it('rejects a callback with an invalid state', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=auth-code&state=invalid-state',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('OAUTH_ERROR');
  });
});
