import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '../utils/errors';

const BEARER_PATTERN = /^Bearer$/i;

/**
 * Validates the `Authorization: Bearer <token>` header and populates
 * `request.user` with the JWT payload.
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;

  if (!header) {
    throw new AppError(
      ErrorCode.UNAUTHORIZED,
      'Missing Authorization header. Send "Authorization: Bearer <accessToken>".',
      401,
    );
  }

  const [scheme, token] = header.split(' ');
  if (!BEARER_PATTERN.test(scheme ?? '') || !token) {
    throw new AppError(
      ErrorCode.UNAUTHORIZED,
      'Invalid Authorization header. Expected format: "Bearer <accessToken>".',
      401,
    );
  }

  try {
    await request.jwtVerify();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
      throw new AppError(
        ErrorCode.UNAUTHORIZED,
        'Access token has expired. Please sign in again.',
        401,
      );
    }
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid or malformed access token', 401);
  }
}
