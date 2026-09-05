import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { env } from './env';

let memoryServer: MongoMemoryServer | null = null;

export async function connectDatabase(): Promise<void> {
  let uri = env.MONGODB_URI;

  if (uri === 'memory') {
    if (env.NODE_ENV === 'production') {
      throw new Error('MONGODB_URI=memory is not allowed in production');
    }
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
    console.log('Using in-memory MongoDB for local development');
  }

  await mongoose.connect(uri, {
    // Outside production Mongoose builds declared indexes on connect, which
    // keeps local development and the test suite self-contained. In production
    // the CI job owns them (`npm run db:indexes`): Atlas index builds are slow
    // and would otherwise be attempted on every serverless cold start.
    autoIndex: env.NODE_ENV !== 'production',
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function pingDatabase(): Promise<boolean> {
  if (!isDatabaseConnected()) {
    return false;
  }
  try {
    await mongoose.connection.db?.admin().ping();
    return true;
  } catch {
    return false;
  }
}
