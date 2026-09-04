import { describe, expect, it } from 'vitest';
import { signupSchema } from '../../src/modules/auth/auth.schemas';

function messagesFor(username: string): string[] {
  const result = signupSchema.safeParse({ username, password: 'password1' });
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('signup schema — username rules', () => {
  it('rejects a username starting with a number', () => {
    expect(messagesFor('1alice')).toContain('Username cannot start with a number');
  });

  it('rejects a username that is only digits', () => {
    expect(messagesFor('12345')).toContain('Username cannot start with a number');
  });

  it('accepts a number anywhere but the first character', () => {
    const result = signupSchema.safeParse({ username: 'alice123', password: 'password1' });
    expect(result.success).toBe(true);
  });

  it('accepts a leading underscore', () => {
    expect(messagesFor('_alice')).toEqual([]);
  });

  it('lowercases the username', () => {
    const result = signupSchema.parse({ username: 'Alice', password: 'password1' });
    expect(result.username).toBe('alice');
  });

  it('enforces length bounds', () => {
    expect(messagesFor('ab')).toContain('Username must be at least 3 characters');
    expect(messagesFor('a'.repeat(31))).toContain(
      'Username must be at most 30 characters',
    );
  });

  it('rejects disallowed characters', () => {
    expect(messagesFor('al ice')).toContain(
      'Username may only contain letters, numbers, and underscores',
    );
  });

  it('requires a password with a letter and a number', () => {
    const short = signupSchema.safeParse({ username: 'alice', password: 'pass1' });
    expect(short.success).toBe(false);

    const noDigit = signupSchema.safeParse({ username: 'alice', password: 'passwords' });
    expect(noDigit.success).toBe(false);
  });
});
