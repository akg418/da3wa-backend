import { User, type IUserDocument } from '../../models/user.model';
import { AppError, ErrorCode } from '../../utils/errors';
import { hashPassword, verifyPassword } from '../../utils/password';
import type { GoogleProfile } from './google-oauth.service';
import type { SigninInput, SignupInput, UserResponse } from './auth.schemas';

export function toUserResponse(user: IUserDocument): UserResponse {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
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

  const byEmail = await User.findOne({ email: profile.email });
  if (byEmail) {
    byEmail.googleId = profile.googleId;
    if (!byEmail.authProviders.includes('google')) {
      byEmail.authProviders.push('google');
    }
    if (!byEmail.displayName && profile.displayName) {
      byEmail.displayName = profile.displayName;
    }
    if (!byEmail.avatarUrl && profile.avatarUrl) {
      byEmail.avatarUrl = profile.avatarUrl;
    }
    await byEmail.save();
    return byEmail;
  }

  return User.create({
    email: profile.email,
    googleId: profile.googleId,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    authProviders: ['google'],
  });
}
