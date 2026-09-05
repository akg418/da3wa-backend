import { randomInt } from 'node:crypto';
import { User } from '../../models/user.model';
import { AppError, ErrorCode } from '../../utils/errors';

const DIGITS = 5;
const MIN_LENGTH = 3;
const MAX_LENGTH = 30;
const MAX_ATTEMPTS = 10;

/**
 * Anything outside plain English letters, digits and spaces. Accented Latin
 * counts as non-English too, so "José Álvarez" gets a generated name rather
 * than a silently mangled one.
 */
const NON_ENGLISH = /[^a-zA-Z0-9 ]/;

function randomDigits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    out += String(randomInt(10));
  }
  return out;
}

/**
 * Derives a username from a Google display name: English only, lowercased,
 * spaces turned into underscores. The result has to satisfy the same rules a
 * local sign-up must pass, so it is 3-30 characters and never starts with a
 * digit. Returns null when the name cannot produce one, which is when the
 * caller falls back to a generated username.
 *
 *   "Ahmed Khaled"  -> "ahmed_khaled"
 *   "José Álvarez"  -> null (not English)
 *   "50 Cent"       -> null (would start with a digit)
 */
export function usernameFromDisplayName(displayName: string | undefined): string | null {
  const trimmed = (displayName ?? '').trim();
  if (trimmed === '' || NON_ENGLISH.test(trimmed)) {
    return null;
  }

  let candidate = trimmed.toLowerCase().replace(/\s+/g, '_');
  if (candidate.length > MAX_LENGTH) {
    candidate = candidate.slice(0, MAX_LENGTH).replace(/_+$/, '');
  }
  if (candidate.length < MIN_LENGTH || /^[0-9]/.test(candidate)) {
    return null;
  }
  return candidate;
}

/** `username_48213` — used when the display name cannot produce one. */
export function generatedUsername(): string {
  return `username_${randomDigits(DIGITS)}`;
}

/** Appends random digits, keeping the result inside the length limit. */
export function usernameWithSuffix(base: string): string {
  return `${base.slice(0, MAX_LENGTH - DIGITS - 1)}_${randomDigits(DIGITS)}`;
}

async function isTaken(username: string): Promise<boolean> {
  return (await User.exists({ username })) !== null;
}

/**
 * Picks a free username for a Google account: the display name, then the
 * display name with random digits, and a fully generated name when there is no
 * usable display name. This narrows the field but cannot guarantee it — two
 * simultaneous sign-ins can still choose the same name, so the unique index is
 * the real arbiter and the caller retries on a duplicate-key error.
 */
export async function allocateUsername(displayName: string | undefined): Promise<string> {
  const base = usernameFromDisplayName(displayName);

  if (base && !(await isTaken(base))) {
    return base;
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = base ? usernameWithSuffix(base) : generatedUsername();
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  throw new AppError(ErrorCode.INTERNAL_ERROR, 'Could not allocate a username', 500);
}
