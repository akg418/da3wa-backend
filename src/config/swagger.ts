import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
} from 'fastify-type-provider-zod';

export const SWAGGER_ROUTE_PREFIX = '/docs';

const DESCRIPTION = `
REST API for username/password and Google OAuth 2.0 authentication.

## Authentication

Call \`POST /auth/signup\` or \`POST /auth/signin\` and keep the \`data.accessToken\` from the
response. Send it on every protected request:

\`\`\`
Authorization: Bearer <accessToken>
\`\`\`

In this page, click **Authorize** and paste the raw token (without the \`Bearer \` prefix) to try
protected endpoints. There are no cookies and no CSRF token on the auth flow — the bearer token is
the only credential. Tokens are stateless, so \`POST /auth/logout\` cannot revoke them; it only
tells the client to discard its copy.

## Errors

Every failure returns the same envelope:

\`\`\`json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Validation failed",
  "details": [{ "field": "username", "message": "Username cannot start with a number" }] } }
\`\`\`

## Rate limiting

Routes under \`/auth\` allow **10 requests per minute per IP** and answer \`429\` beyond that.
`.trim();

/**
 * Rewrites redirect responses: a 3xx has no JSON body, so drop the generated
 * `content` block and document the `Location` header instead.
 */
function documentRedirects(document: Record<string, any>): Record<string, any> {
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(pathItem as Record<string, any>)) {
      const responses = (operation as Record<string, any>)?.responses;
      if (!responses) {
        continue;
      }
      for (const [status, response] of Object.entries<any>(responses)) {
        if (!status.startsWith('3')) {
          continue;
        }
        delete response.content;
        response.headers = {
          Location: {
            description: 'Absolute URL the client must follow.',
            schema: { type: 'string', format: 'uri' },
          },
        };
      }
    }
  }
  return document;
}

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Invitations Auth API',
        description: DESCRIPTION,
        version: '1.0.0',
        license: { name: 'ISC', identifier: 'ISC' },
      },
      // Relative, so "Try it out" targets whatever host is serving this page.
      servers: [{ url: '/', description: 'This server' }],
      tags: [
        { name: 'System', description: 'Service and database health.' },
        { name: 'Authentication', description: 'Username/password sign-up and sign-in.' },
        { name: 'Google OAuth', description: 'Google OAuth 2.0 authorization-code flow.' },
        { name: 'Session', description: 'Endpoints that require a bearer token.' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'JWT returned as `data.accessToken` by `/auth/signup`, `/auth/signin`, and the Google callback.',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: (input) => documentRedirects(jsonSchemaTransformObject(input) as never),
  });

  await app.register(swaggerUi, {
    routePrefix: SWAGGER_ROUTE_PREFIX,
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
      tryItOutEnabled: true,
    },
    // Helmet already sets the Content-Security-Policy for every response.
    staticCSP: false,
  });
}
