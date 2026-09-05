import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { User } from '../../src/models/user.model';
import { findOrCreateGoogleUser, signUp } from '../../src/modules/auth/auth.service';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';

/** The stored document, minus the fields that vary per run. */
async function storedDocument(username: string) {
  const doc = await mongoose.connection.db!.collection('users').findOne({ username });
  const { _id, createdAt, updatedAt, __v, ...rest } = doc!;
  return rest;
}

describe('user documents', () => {
  beforeEach(async () => {
    await setupTestDatabase();
    // The suite connects directly, so build the declared indexes explicitly.
    await User.syncIndexes();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it('stores only username, passwordHash and authProviders for a local sign-up', async () => {
    await signUp({ username: 'localuser', password: 'password1' });
    const doc = await storedDocument('localuser');

    expect(Object.keys(doc).sort()).toEqual(['authProviders', 'passwordHash', 'username']);
    expect(doc.authProviders).toEqual(['local']);
    expect(doc.passwordHash).toBeTypeOf('string');
  });

  it('stores only username, email, googleId and authProviders for a google account', async () => {
    await findOrCreateGoogleUser({
      googleId: 'google-1',
      email: 'someone@gmail.com',
      displayName: 'Some One',
    });
    const doc = await storedDocument('some_one');

    expect(Object.keys(doc).sort()).toEqual([
      'authProviders',
      'email',
      'googleId',
      'username',
    ]);
    expect(doc.authProviders).toEqual(['google']);
  });

  it('does not write placeholders for the fields a flow has no value for', async () => {
    await signUp({ username: 'localuser', password: 'password1' });
    await findOrCreateGoogleUser({
      googleId: 'google-1',
      email: 'someone@gmail.com',
      displayName: 'Some One',
    });

    const local = await storedDocument('localuser');
    const google = await storedDocument('some_one');

    // Absent, not null and not '' — the keys must not be there at all.
    for (const field of ['email', 'googleId', 'displayName', 'avatarUrl']) {
      expect(local, `local.${field}`).not.toHaveProperty(field);
    }
    for (const field of ['passwordHash', 'displayName', 'avatarUrl']) {
      expect(google, `google.${field}`).not.toHaveProperty(field);
    }
  });

  // Absent fields are skipped by the partial index. This is the case that fails
  // under a plain unique index, and under a sparse one once any account still
  // carries a null or '' left over from an earlier schema.
  it('allows many local accounts, none of which have an email', async () => {
    await signUp({ username: 'first', password: 'password1' });
    await signUp({ username: 'second', password: 'password1' });
    await signUp({ username: 'third', password: 'password1' });

    expect(await User.countDocuments({ email: { $exists: false } })).toBe(3);
  });

  it('still rejects a duplicate real email', async () => {
    await User.create({ username: 'one', email: 'taken@gmail.com', authProviders: ['google'] });
    await expect(
      User.create({ username: 'two', email: 'taken@gmail.com', authProviders: ['google'] }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('still rejects a duplicate username across the two flows', async () => {
    await signUp({ username: 'taken_name', password: 'password1' });
    await expect(
      User.create({ username: 'taken_name', email: 'x@gmail.com', authProviders: ['google'] }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('google usernames', () => {
  beforeEach(async () => {
    await setupTestDatabase();
    await User.syncIndexes();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it('derives the username from the display name', async () => {
    const user = await findOrCreateGoogleUser({
      googleId: 'google-1',
      email: 'ahmed@gmail.com',
      displayName: 'Ahmed Khaled',
    });
    expect(user.username).toBe('ahmed_khaled');
  });

  it('generates username_xxxxx when google sends no display name', async () => {
    const user = await findOrCreateGoogleUser({
      googleId: 'google-1',
      email: 'noname@gmail.com',
    });
    expect(user.username).toMatch(/^username_[0-9]{5}$/);
  });

  it('generates username_xxxxx when the display name is not English', async () => {
    const user = await findOrCreateGoogleUser({
      googleId: 'google-1',
      email: 'arabic@gmail.com',
      displayName: 'أحمد خالد',
    });
    expect(user.username).toMatch(/^username_[0-9]{5}$/);
  });

  it('suffixes the username when the derived one is taken', async () => {
    const first = await findOrCreateGoogleUser({
      googleId: 'google-1',
      email: 'a@gmail.com',
      displayName: 'Ahmed Khaled',
    });
    const second = await findOrCreateGoogleUser({
      googleId: 'google-2',
      email: 'b@gmail.com',
      displayName: 'Ahmed Khaled',
    });

    expect(first.username).toBe('ahmed_khaled');
    expect(second.username).toMatch(/^ahmed_khaled_[0-9]{5}$/);
  });

  it('does not collide with an existing local username', async () => {
    await signUp({ username: 'ahmed_khaled', password: 'password1' });
    const user = await findOrCreateGoogleUser({
      googleId: 'google-1',
      email: 'ahmed@gmail.com',
      displayName: 'Ahmed Khaled',
    });

    expect(user.username).toMatch(/^ahmed_khaled_[0-9]{5}$/);
  });

  it('keeps the existing username when linking google to an account by email', async () => {
    await User.create({
      username: 'localuser',
      email: 'link@gmail.com',
      passwordHash: 'hash',
      authProviders: ['local'],
    });

    const user = await findOrCreateGoogleUser({
      googleId: 'google-1',
      email: 'link@gmail.com',
      displayName: 'Totally Different',
    });

    expect(user.username).toBe('localuser');
    expect(user.authProviders).toEqual(['local', 'google']);
  });
});
