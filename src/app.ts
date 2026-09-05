import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { env } from './config/env';
import { isDatabaseConnected, pingDatabase } from './config/database';
import { registerSwagger } from './config/swagger';
import { errorHandler } from './middleware/error-handler';
import { authenticate } from './middleware/authenticate';
import { authRoutes } from './modules/auth/auth.routes';
import {
  commonErrorResponses,
  healthDegradedResponse,
  healthOkResponse,
  pingResponse,
} from './schemas/api.schemas';
import { ErrorCode } from './utils/errors';

export async function buildApp() {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true },
            },
          }
        : env.NODE_ENV !== 'test',
    trustProxy: env.NODE_ENV === 'production',
  });

  // Validate requests and serialize responses with the same Zod schemas the
  // OpenAPI document is generated from, so the two can never drift apart.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
  // Helmet's default CSP already allows what Swagger UI needs (same-origin
  // scripts, inline styles), so it stays on and @fastify/swagger-ui is told not
  // to emit a second, stricter policy of its own.
  await app.register(helmet);
  await app.register(cors, {
    origin: env.FRONTEND_URL,
  });
  // Only used to sign the short-lived Google OAuth `state` cookie.
  await app.register(cookie, {
    secret: env.JWT_SECRET,
    parseOptions: {},
  });
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  app.decorate('authenticate', authenticate);

  app.setErrorHandler(errorHandler);

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      error: {
        code: ErrorCode.NOT_FOUND,
        message: `Route ${request.method} ${request.url} not found`,
      },
    });
  });

  // Must run before any documented route is registered.
  if (env.SWAGGER_ENABLED) {
    await registerSwagger(app);
  }

  // Liveness probe at the root URL: answers without touching the database, so
  // it stays green while `/health` reports a degraded dependency.
  app.get(
    '/',
    {
      schema: {
        tags: ['System'],
        summary: 'Ping',
        description:
          'Returns `pong`. Cheapest possible check that the process is up and routing requests; it does not touch MongoDB — use `/health` for that.',
        operationId: 'ping',
        security: [],
        response: {
          200: pingResponse,
          ...commonErrorResponses,
        },
      },
    },
    async () => ({ success: true as const, data: { message: 'pong' as const } }),
  );

  app.get(
    `${env.API_PREFIX}/health`,
    {
      schema: {
        tags: ['System'],
        summary: 'Health check',
        description:
          'Reports whether the process is up and MongoDB answers a ping. Returns 503 when the database is unreachable, so it can be wired straight into a readiness probe.',
        operationId: 'health',
        security: [],
        response: {
          200: healthOkResponse,
          503: healthDegradedResponse,
          ...commonErrorResponses,
        },
      },
    },
    async (_request, reply) => {
      const dbConnected = isDatabaseConnected();
      const dbResponsive = dbConnected ? await pingDatabase() : false;
      const healthy = dbConnected && dbResponsive;

      reply.status(healthy ? 200 : 503).send({
        success: healthy,
        data: {
          status: healthy ? 'ok' : 'degraded',
          database: dbResponsive ? 'connected' : 'disconnected',
        },
      });
    },
  );

  await app.register(authRoutes, { prefix: `${env.API_PREFIX}/auth` });

  return app;
}
