import { describe, expect, it } from 'vitest';
import {
  generatedUsername,
  usernameFromDisplayName,
} from '../../src/modules/auth/username';

/** The rule a local sign-up must satisfy; a derived name has to pass it too. */
const USERNAME_RULE = /^[a-zA-Z_][a-zA-Z0-9_]{2,29}$/;

describe('usernameFromDisplayName', () => {
  it('lowercases and turns spaces into underscores', () => {
    expect(usernameFromDisplayName('Ahmed Khaled')).toBe('ahmed_khaled');
    expect(usernameFromDisplayName('Alice Smith')).toBe('alice_smith');
  });

  it('collapses repeated and surrounding whitespace', () => {
    expect(usernameFromDisplayName('  Alice   Smith  ')).toBe('alice_smith');
  });

  it('keeps digits that are not leading', () => {
    expect(usernameFromDisplayName('Ahmed Gomaa 2')).toBe('ahmed_gomaa_2');
  });

  it('rejects names that are not English', () => {
    expect(usernameFromDisplayName('أحمد خالد')).toBeNull();
    expect(usernameFromDisplayName('李明')).toBeNull();
    expect(usernameFromDisplayName('Иван')).toBeNull();
  });

  it('treats accented latin as not English', () => {
    expect(usernameFromDisplayName('José Álvarez')).toBeNull();
    expect(usernameFromDisplayName('Renée')).toBeNull();
  });

  it('rejects names carrying punctuation', () => {
    expect(usernameFromDisplayName("O'Brien")).toBeNull();
    expect(usernameFromDisplayName('Mary-Jane')).toBeNull();
    expect(usernameFromDisplayName('a.b@c')).toBeNull();
  });

  it('rejects a name that would start with a digit', () => {
    expect(usernameFromDisplayName('50 Cent')).toBeNull();
  });

  it('rejects a name too short to be a username', () => {
    expect(usernameFromDisplayName('Li')).toBeNull();
    expect(usernameFromDisplayName('')).toBeNull();
    expect(usernameFromDisplayName('   ')).toBeNull();
    expect(usernameFromDisplayName(undefined)).toBeNull();
  });

  it('truncates a long name to the 30 character limit', () => {
    const result = usernameFromDisplayName('a'.repeat(40))!;
    expect(result).toHaveLength(30);
    expect(USERNAME_RULE.test(result)).toBe(true);
  });

  it('never leaves a trailing underscore after truncating', () => {
    // 30 characters lands exactly on the space between the two words.
    const result = usernameFromDisplayName(`${'a'.repeat(30)} Smith`)!;
    expect(result.endsWith('_')).toBe(false);
  });

  it('produces names that satisfy the sign-up username rules', () => {
    for (const name of ['Ahmed Khaled', 'Alice Smith', 'Ahmed Gomaa 2']) {
      expect(USERNAME_RULE.test(usernameFromDisplayName(name)!), name).toBe(true);
    }
  });
});

describe('generatedUsername', () => {
  it('is username_ plus five digits', () => {
    expect(generatedUsername()).toMatch(/^username_[0-9]{5}$/);
  });

  it('satisfies the sign-up username rules', () => {
    expect(USERNAME_RULE.test(generatedUsername())).toBe(true);
  });

  it('does not repeat itself', () => {
    const names = new Set(Array.from({ length: 50 }, generatedUsername));
    expect(names.size).toBeGreaterThan(45);
  });
});
