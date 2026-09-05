import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { buildApp } from '../../src/app';
import { bearer, setupTestDatabase, teardownTestDatabase } from '../helpers/setup';

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: { name: string; in: string; required: boolean; description?: string }[];
  requestBody?: { required?: boolean; content: Record<string, { schema: unknown }> };
  responses: Record<string, { description?: string; content?: unknown; headers?: unknown }>;
};

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

/**
 * Rebuilds full route paths from `printRoutes()`, which renders a tree where a
 * child line holds only its own path segment.
 */
function registeredRoutes(tree: string): { method: string; path: string }[] {
  const stack: string[] = [];
  const routes: { method: string; path: string }[] = [];

  for (const line of tree.split('\n')) {
    const match = line.match(/^((?:[│ ] {3})*)(?:├── |└── )(.*)$/);
    if (!match) {
      continue;
    }
    const depth = match[1].length / 4;
    const [, segment, methodList] = match[2].match(/^(.*?)(?: \(([^)]*)\))?$/) ?? [];

    stack.length = depth;
    stack[depth] = segment ?? '';

    if (!methodList) {
      continue;
    }
    const path = stack.slice(0, depth + 1).join('');
    for (const method of methodList.split(', ')) {
      routes.push({ method: method.toLowerCase(), path });
    }
  }
  return routes;
}

/** Routes the app really serves, minus the docs UI and framework wildcards. */
function documentableRoutes(tree: string): Set<string> {
  return new Set(
    registeredRoutes(tree)
      .filter(({ method, path }) => method !== 'head' && method !== 'options')
      .filter(({ path }) => !path.startsWith('/docs') && !path.includes('*'))
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`),
  );
}

describe('OpenAPI document', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let doc: {
    openapi: string;
    info: Record<string, unknown>;
    servers: { url: string }[];
    tags: { name: string; description?: string }[];
    components: { securitySchemes: Record<string, Record<string, string>> };
    paths: Record<string, Record<string, Operation>>;
  };

  function operations(): [string, string, Operation][] {
    return Object.entries(doc.paths).flatMap(([path, item]) =>
      HTTP_METHODS.filter((method) => item[method]).map(
        (method) => [method, path, item[method]] as [string, string, Operation],
      ),
    );
  }

  beforeEach(async () => {
    await setupTestDatabase();
    app = await buildApp();
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    doc = response.json();
  });

  afterEach(async () => {
    await app.close();
    await teardownTestDatabase();
  });

  it('serves a well-formed OpenAPI 3.1 document', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toMatchObject({ title: 'Invitations Auth API', version: '1.0.0' });
    expect(doc.servers[0].url).toBe('/');
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('documents every route the app actually serves, and nothing else', () => {
    const real = documentableRoutes(app.printRoutes({ commonPrefix: false }));
    const documented = new Set(
      operations().map(([method, path]) => `${method.toUpperCase()} ${path}`),
    );

    // Guards against the tree parser silently returning nothing.
    expect(real.size).toBe(8);
    expect(documented).toEqual(real);
  });

  it('points every documented operation at a real route', () => {
    for (const [method, path] of operations()) {
      expect(
        app.hasRoute({ method: method.toUpperCase() as 'GET', url: path }),
        `${method.toUpperCase()} ${path} is documented but not routed`,
      ).toBe(true);
    }
  });

  it('gives every operation a summary, description, tag and unique operationId', () => {
    const ids: string[] = [];

    for (const [method, path, operation] of operations()) {
      const label = `${method.toUpperCase()} ${path}`;
      expect(operation.summary, `${label} has no summary`).toBeTruthy();
      expect(operation.description, `${label} has no description`).toBeTruthy();
      expect(operation.operationId, `${label} has no operationId`).toBeTruthy();
      expect(operation.tags?.length, `${label} has no tag`).toBeGreaterThan(0);
      expect(
        doc.tags.map((tag) => tag.name),
        `${label} uses an undeclared tag`,
      ).toEqual(expect.arrayContaining(operation.tags!));
      ids.push(operation.operationId!);
    }

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states the authentication requirement on every operation', () => {
    const protectedRoutes = new Set(['/api/v1/auth/me', '/api/v1/auth/logout']);

    for (const [method, path, operation] of operations()) {
      const label = `${method.toUpperCase()} ${path}`;
      expect(operation.security, `${label} does not state its auth`).toBeDefined();

      if (protectedRoutes.has(path)) {
        expect(operation.security, label).toEqual([{ bearerAuth: [] }]);
        expect(Object.keys(operation.responses), label).toContain('401');
      } else {
        expect(operation.security, `${label} should be public`).toEqual([]);
      }
    }
  });

  it('describes every response, including the shared 429 and 500', () => {
    for (const [method, path, operation] of operations()) {
      const label = `${method.toUpperCase()} ${path}`;
      const codes = Object.keys(operation.responses);

      expect(codes.length, `${label} documents no response`).toBeGreaterThan(0);
      expect(codes, `${label} is missing the rate-limit response`).toContain('429');
      expect(codes, `${label} is missing the 500 response`).toContain('500');

      for (const [status, response] of Object.entries(operation.responses)) {
        expect(response.description, `${label} -> ${status} has no description`).toBeTruthy();

        if (status.startsWith('3')) {
          // Redirects carry no body; they must document Location instead.
          expect(response.content, `${label} -> ${status} should have no body`).toBeUndefined();
          expect(response.headers, `${label} -> ${status} must document Location`).toHaveProperty(
            'Location',
          );
        } else {
          expect(response.content, `${label} -> ${status} has no schema`).toHaveProperty(
            'application/json',
          );
        }
      }
    }
  });

  it('documents request bodies and query parameters', () => {
    const signup = doc.paths['/api/v1/auth/signup'].post;
    const body = signup.requestBody!.content['application/json'].schema as {
      required: string[];
      properties: Record<string, { description?: string; pattern?: string }>;
    };
    expect(signup.requestBody!.required).toBe(true);
    expect(body.required).toEqual(['username', 'password']);
    expect(body.properties.username.description).toContain('must not start with a number');
    // The rendered pattern must express the whole rule, not just the last regex.
    expect(body.properties.username.pattern).toBe('^[a-zA-Z_][a-zA-Z0-9_]{2,29}$');
    for (const candidate of ['alice_99', '_alice', 'abc']) {
      expect(new RegExp(body.properties.username.pattern!).test(candidate), candidate).toBe(true);
    }
    for (const candidate of ['1alice', 'ab', 'bad user', 'a'.repeat(31)]) {
      expect(new RegExp(body.properties.username.pattern!).test(candidate), candidate).toBe(false);
    }
    expect(body.properties.password.description).toContain('one letter and one number');

    const callback = doc.paths['/api/v1/auth/google/callback'].get;
    const params = Object.fromEntries(callback.parameters!.map((p) => [p.name, p]));
    expect(Object.keys(params).sort()).toEqual(['code', 'error', 'state']);
    for (const param of callback.parameters!) {
      expect(param.in, param.name).toBe('query');
      expect(param.description, `query param ${param.name} has no description`).toBeTruthy();
    }
  });

  it('documents the error envelope with its codes', () => {
    const schema = doc.paths['/api/v1/auth/signup'].post.responses['400'].content as Record<
      string,
      { schema: { properties: Record<string, any> } }
    >;
    const error = schema['application/json'].schema.properties.error;

    expect(Object.keys(error.properties).sort()).toEqual(['code', 'details', 'message']);
    expect(error.properties.code.enum).toEqual(
      expect.arrayContaining([
        'VALIDATION_ERROR',
        'UNAUTHORIZED',
        'CONFLICT',
        'TOO_MANY_REQUESTS',
        'OAUTH_ERROR',
        'INTERNAL_ERROR',
      ]),
    );
  });

  it('serves the Swagger UI and its assets', async () => {
    const ui = await app.inject({ method: 'GET', url: '/docs' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    expect(ui.body).toContain('<div id="swagger-ui">');
    expect(ui.body).toContain('/docs/static/swagger-ui-bundle.js');

    for (const asset of [
      '/docs/static/swagger-ui.css',
      '/docs/static/swagger-ui-bundle.js',
      '/docs/static/swagger-initializer.js',
    ]) {
      const response = await app.inject({ method: 'GET', url: asset });
      expect(response.statusCode, `${asset} did not load`).toBe(200);
      expect(response.body.length, `${asset} is empty`).toBeGreaterThan(0);
    }

    const initializer = await app.inject({
      method: 'GET',
      url: '/docs/static/swagger-initializer.js',
    });
    expect(initializer.body).toContain("resolveUrl('./json')");
  });

  it('serves the document as YAML too', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/yaml' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('yaml');
    expect(response.body).toContain('openapi: 3.1.0');
  });
});

describe('documented behaviour matches the document', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    await setupTestDatabase();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    await teardownTestDatabase();
  });

  it('returns the documented 429 once the auth rate limit is exceeded', async () => {
    let last = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    for (let i = 0; i < 11; i += 1) {
      last = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    }

    expect(last.statusCode).toBe(429);
    expect(last.json()).toMatchObject({
      success: false,
      error: { code: 'TOO_MANY_REQUESTS' },
    });
    expect(last.headers['retry-after']).toBeDefined();
  });

  it('returns the documented error envelope for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('returns the documented 503 health payload when the database is down', async () => {
    const uri = mongoose.connection.getClient().options.srvHost
      ? mongoose.connection.host
      : `mongodb://${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name}`;
    await mongoose.disconnect();

    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        success: false,
        data: { status: 'degraded', database: 'disconnected' },
      });
    } finally {
      // Reconnect so the shared teardown can still drop the database.
      await mongoose.connect(uri);
    }
  });

  it('returns the documented 200 health payload', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { status: 'ok', database: 'connected' },
    });
  });
});
