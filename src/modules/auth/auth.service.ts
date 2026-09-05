import { User, type IUserDocument } from '../../models/user.model';
import { AppError, ErrorCode } from '../../utils/errors';
import { hashPassword, verifyPassword } from '../../utils/password';
import type { GoogleProfile } from './google-oauth.service';
import type { SigninInput, SignupInput, UserResponse } from './auth.schemas';
import { allocateUsername } from './username';

/** MongoDB's duplicate-key error. */
const DUPLICATE_KEY = 11000;
const MAX_CREATE_ATTEMPTS = 3;

function isDuplicateUsername(error: unknown): boolean {
  const candidate = error as { code?: number; keyPattern?: Record<string, unknown> };
  return candidate?.code === DUPLICATE_KEY && candidate.keyPattern?.username !== undefined;
}

export function toUserResponse(user: IUserDocument): UserResponse {
  return {
    id: user._id.toString(),
    username: user.username,
    // Absent on a local account, so the key is left out of the response too.
    ...(user.email ? { email: user.email } : {}),
    authProviders: user.authProviders,
  };
}

export async function signUp(input: SignupInput): Promise<IUserDocument> {
  const existing = await User.findOne({ username: input.username.toLowerCase() });
  if (existing) {
    throw new AppError(ErrorCode.CONFLICT, 'Username is already taken', 409);
  }

  const passwordHash = await hashPassword(input.password);

  const user = await User.create({
    username: input.username.toLowerCase(),
    passwordHash,
    authProviders: ['local'],
  });

  return user;
}

export async function signIn(input: SigninInput): Promise<IUserDocument> {
  const user = await User.findOne({ username: input.username.toLowerCase() }).select(
    '+passwordHash',
  );

  if (!user || !user.passwordHash) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid credentials', 401);
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid credentials', 401);
  }

  return user;
}

export async function getUserById(id: string): Promise<IUserDocument | null> {
  return User.findById(id);
}

export async function findOrCreateGoogleUser(
  profile: GoogleProfile,
): Promise<IUserDocument> {
  const byGoogleId = await User.findOne({ googleId: profile.googleId });
  if (byGoogleId) {
    return byGoogleId;
  }

  // Local accounts store an empty `email`, so an empty profile email must not
  // be allowed to match one of them.
  const byEmail = profile.email ? await User.findOne({ email: profile.email }) : null;
  if (byEmail) {
    byEmail.googleId = profile.googleId;
    if (!byEmail.authProviders.includes('google')) {
      byEmail.authProviders.push('google');
    }
    await byEmail.save();
    return byEmail;
  }

  // `allocateUsername` checks availability first, but two concurrent sign-ins
  // can still land on the same name; the unique index catches that, so retry
  // with a freshly allocated one rather than failing the sign-in.
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return await User.create({
        username: await allocateUsername(profile.displayName),
        email: profile.email,
        googleId: profile.googleId,
        authProviders: ['google'],
      });
    } catch (error) {
      if (!isDuplicateUsername(error) || attempt === MAX_CREATE_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new AppError(ErrorCode.INTERNAL_ERROR, 'Could not create the account', 500);
}
