import type { IncomingMessage, ServerResponse } from 'http';
import mongoose from 'mongoose';
import { buildApp } from './src/app';
import { env } from './src/config/env';

  let appPromise: ReturnType<typeof buildApp> | null = null;
  let dbPromise: Promise<unknown> | null = null;

  async function ensureDb(): Promise<void> {
    if (mongoose.connection.readyState === 1) return;
    if (!dbPromise) {
      dbPromise = mongoose.connect(env.MONGODB_URI).catch((err) => {
        dbPromise = null;
        throw err;
      });
    }
      await dbPromise;
  }

    async function getApp() {
      if (!appPromise) {
        appPromise = buildApp();
      }
        return appPromise;
    }

      export default async function handler(
        req: IncomingMessage,
        res: ServerResponse,
      ): Promise<void> {
        await ensureDb();
        const app = await getApp();
        await app.ready();
        app.server.emit('request', req, res);
      }
