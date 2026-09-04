import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/utils/password';

describe('password utilities', () => {
  it('hashes and verifies a password', async () => {
    const password = 'password1';
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('password1');
    await expect(verifyPassword('wrongpass1', hash)).resolves.toBe(false);
  });
});
