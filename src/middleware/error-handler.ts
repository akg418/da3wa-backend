import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { env } from '../config/env';
import {
  duplicateKeyMessage,
  errorCodeForStatus,
  ErrorCode,
  isAppError,
  isDuplicateKeyError,
} from '../utils/errors';

/** `/username` -> `username`, `/items/0/name` -> `items.0.name` */
function toFieldPath(instancePath: string): string {
  return instancePath.replace(/^\//, '').replace(/\//g, '.');
}

export function errorHandler(
  error: Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Request failed the route's Zod schema (body, query string, params).
  if (hasZodFastifySchemaValidationErrors(error)) {
    reply.status(400).send({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: error.validation.map((issue) => ({
          field: toFieldPath(issue.instancePath),
          message: issue.message ?? 'Invalid value',
        })),
      },
    });
    return;
  }

  // A handler produced a payload that does not match its declared response
  // schema. That is a server bug, so log loudly and answer 500.
  if (isResponseSerializationError(error)) {
    request.log.error(
      { err: error, route: `${error.method} ${error.url}` },
      'Response did not match its declared schema',
    );
    reply.status(500).send({
      success: false,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message:
          env.NODE_ENV === 'production'
            ? 'Internal server error'
            : `Response serialization failed: ${error.message}`,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    reply.status(400).send({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (isAppError(error)) {
    reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (isDuplicateKeyError(error)) {
    reply.status(409).send({
      success: false,
      error: {
        code: ErrorCode.CONFLICT,
        message: duplicateKeyMessage(error),
      },
    });
    return;
  }

  // Errors raised by Fastify or its plugins already carry the right status:
  // rate limiting (429), unparseable JSON body (400), and so on.
  const statusCode = (error as FastifyError).statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    reply.status(statusCode).send({
      success: false,
      error: {
        code: errorCodeForStatus(statusCode),
        message: error.message,
      },
    });
    return;
  }

  request.log.error(error);

  reply.status(500).send({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message:
        env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    },
  });
}
