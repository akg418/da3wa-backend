export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  OAUTH_ERROR = 'OAUTH_ERROR',
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: number }).code === 11000
  );
}

export function duplicateKeyMessage(error: unknown): string {
  if (!isDuplicateKeyError(error)) {
    return 'Resource already exists';
  }
  const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern;
  if (keyPattern?.username) {
    return 'Username is already taken';
  }
  if (keyPattern?.email) {
    return 'Email is already registered. Try signing in with Google.';
  }
  if (keyPattern?.googleId) {
    return 'Google account is already linked';
  }
  return 'Resource already exists';
}

const STATUS_TO_ERROR_CODE: Record<number, ErrorCode> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  429: ErrorCode.TOO_MANY_REQUESTS,
};

/** Maps a framework-generated HTTP status (rate limit, bad JSON body, ...) onto our error codes. */
export function errorCodeForStatus(statusCode: number): ErrorCode {
  return STATUS_TO_ERROR_CODE[statusCode] ?? ErrorCode.BAD_REQUEST;
}
