import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { User } from '../../src/models/user.model';
import { signIn, signUp } from '../../src/modules/auth/auth.service';
import { AppError } from '../../src/utils/errors';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';

describe('auth service', () => {
  beforeEach(async () => {
    await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it('creates a local user on sign up', async () => {
    const user = await signUp({ username: 'testuser', password: 'password1' });
    expect(user.username).toBe('testuser');
    expect(user.authProviders).toContain('local');
    expect(user.passwordHash).toBeDefined();
  });

  it('signs in with valid credentials', async () => {
    await signUp({ username: 'testuser', password: 'password1' });
    const user = await signIn({ username: 'testuser', password: 'password1' });
    expect(user.username).toBe('testuser');
  });

  it('rejects invalid credentials', async () => {
    await signUp({ username: 'testuser', password: 'password1' });
    await expect(
      signIn({ username: 'testuser', password: 'wrongpass1' }),
    ).rejects.toThrow(AppError);
  });

  it('rejects duplicate username', async () => {
    await signUp({ username: 'testuser', password: 'password1' });
    await expect(
      signUp({ username: 'testuser', password: 'password2' }),
    ).rejects.toThrow('Username is already taken');
  });

  it('links google account to existing user by email', async () => {
    const { findOrCreateGoogleUser } = await import('../../src/modules/auth/auth.service');
    await User.create({
      username: 'localuser',
      email: 'user@example.com',
      passwordHash: 'hash',
      authProviders: ['local'],
    });

    const user = await findOrCreateGoogleUser({
      googleId: 'google-123',
      email: 'user@example.com',
      displayName: 'Test User',
    });

    expect(user.googleId).toBe('google-123');
    expect(user.authProviders).toContain('google');
    expect(user.authProviders).toContain('local');
  });
});
