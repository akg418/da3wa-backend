import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { bearer, setupTestDatabase, teardownTestDatabase } from '../helpers/setup';

describe('local auth integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    await setupTestDatabase();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    await teardownTestDatabase();
  });

  async function signup(username: string, password = 'password1') {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { username, password },
    });
  }

  it('signs up and returns an access token in the body', async () => {
    const response = await signup('newuser');

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.user.username).toBe('newuser');
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.tokenType).toBe('Bearer');
    expect(body.data.expiresIn).toBe(3600);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('signs in and accesses /me with the bearer token', async () => {
    await signup('loginuser');

    const signinRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      payload: { username: 'loginuser', password: 'password1' },
    });
    expect(signinRes.statusCode).toBe(200);
    const { accessToken } = signinRes.json().data;

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(accessToken),
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().data.user.username).toBe('loginuser');
  });

  it('signs in case-insensitively', async () => {
    await signup('mixedcase');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      payload: { username: 'MixedCase', password: 'password1' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a username starting with a number with a clear message', async () => {
    const response = await signup('1username');

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    const messages = body.error.details.map((d: { message: string }) => d.message);
    expect(messages).toContain('Username cannot start with a number');
  });

  it('rejects a username with invalid characters', async () => {
    const response = await signup('bad user!');

    expect(response.statusCode).toBe(400);
    const messages = response
      .json()
      .error.details.map((d: { message: string }) => d.message);
    expect(messages).toContain(
      'Username may only contain letters, numbers, and underscores',
    );
  });

  it('accepts a username that merely contains a number', async () => {
    const response = await signup('user123');
    expect(response.statusCode).toBe(201);
    expect(response.json().data.user.username).toBe('user123');
  });

  it('returns 409 for a duplicate username', async () => {
    await signup('dupeuser');
    const response = await signup('dupeuser', 'password2');

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });

  it('returns 401 for wrong credentials', async () => {
    await signup('realuser');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      payload: { username: 'realuser', password: 'wrongpass1' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe('Invalid credentials');
  });

  it('rejects /me without an Authorization header', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toContain('Missing Authorization header');
  });

  it('rejects /me with a malformed Authorization header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Token abc' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toContain('Invalid Authorization header');
  });

  it('rejects /me with a tampered token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer('not.a.jwt'),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe('Invalid or malformed access token');
  });

  it('logs out an authenticated caller without CSRF', async () => {
    const signupRes = await signup('logoutuser');
    const { accessToken } = signupRes.json().data;

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: bearer(accessToken),
    });
    expect(logoutRes.statusCode).toBe(200);
  });
});
