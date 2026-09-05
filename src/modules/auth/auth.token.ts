import type { FastifyReply } from 'fastify';
import { env, parseJwtExpiresInSeconds } from '../../config/env';
import type { IUserDocument } from '../../models/user.model';

export interface AccessTokenPayload {
  accessToken: string;
  tokenType: 'Bearer';
  /** Lifetime of the access token in seconds. */
  expiresIn: number;
}

/**
 * Signs a stateless JWT for the given user. This is the only credential the
 * API hands out on a successful sign-up / sign-in; clients send it back as
 * `Authorization: Bearer <accessToken>`.
 */
export async function issueAccessToken(
  reply: FastifyReply,
  user: IUserDocument,
): Promise<AccessTokenPayload> {
  const accessToken = await reply.jwtSign({
    sub: String(user._id),
    username: user.username,
    // A local account has no email; leave the claim out rather than signing a
    // null one, since an absent claim is what a JWT consumer expects.
    ...(user.email ? { email: user.email } : {}),
  });

  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: parseJwtExpiresInSeconds(env.JWT_EXPIRES_IN),
  };
}
