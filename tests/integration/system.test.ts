import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';

describe('system routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    await setupTestDatabase();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    await teardownTestDatabase();
  });

  it('answers pong at the root URL', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: { message: 'pong' } });
  });

  it('reports a healthy database at /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { status: 'ok', database: 'connected' },
    });
  });
});
