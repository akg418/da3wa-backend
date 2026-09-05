/**
 * Reconciles the indexes in MongoDB with the ones declared on the Mongoose
 * schemas, and reports what changed.
 *
 * MongoDB has no server-side schema to migrate — documents are shaped and
 * validated by the application, not by the cluster. Indexes are the one part of
 * a Mongoose schema that is real server-side state, so for Atlas "applying the
 * schema" means reconciling indexes. Adding, renaming or removing a *field*
 * needs a data migration instead; nothing here can infer one.
 *
 * Reads MONGODB_URI straight from the environment rather than through
 * config/env, so a deploy job needs that one secret and not the app's whole
 * environment.
 *
 *   npm run db:indexes:check   # report the difference, change nothing
 *   npm run db:indexes         # apply it
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

const MODELS_DIR = path.join(__dirname, '..', 'models');

/**
 * Loads every model file so `mongoose.modelNames()` is complete. Scanning the
 * directory rather than listing imports means a newly added model cannot be
 * silently left out of the sync.
 */
function registerModels(): string[] {
  const files = fs.readdirSync(MODELS_DIR).filter((file) => /\.model\.(ts|js)$/.test(file));
  for (const file of files) {
    require(path.join(MODELS_DIR, file));
  }
  return files;
}

/** Strips credentials so the target is safe to print in a CI log. */
function redact(uri: string): string {
  return uri.replace(/\/\/[^@]*@/, '//<credentials>@');
}

function describe(index: unknown): string {
  const spec = index as { name?: string; key?: Record<string, unknown> } | unknown[];
  if (Array.isArray(spec)) {
    return JSON.stringify(spec[0]);
  }
  const key = JSON.stringify(spec?.key ?? spec);
  return spec?.name ? `${spec.name} ${key}` : key;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is not set.');
  }
  if (uri === 'memory') {
    throw new Error('MONGODB_URI=memory has no cluster to sync. Point it at a real database.');
  }

  const files = registerModels();
  const names = mongoose.modelNames();
  if (names.length === 0) {
    throw new Error(`No models found in ${MODELS_DIR} (scanned: ${files.join(', ') || 'nothing'})`);
  }

  console.log(`${dryRun ? 'Checking' : 'Syncing'} indexes on ${redact(uri)}`);
  // autoIndex would build indexes in the background as soon as the models are
  // registered, racing this script and hiding what it actually changed.
  await mongoose.connect(uri, { autoIndex: false });

  let pending = 0;

  try {
    for (const name of names) {
      const model = mongoose.model(name);
      const { toCreate, toDrop } = await model.diffIndexes();
      const collection = model.collection.collectionName;

      if (toCreate.length === 0 && toDrop.length === 0) {
        console.log(`  ${collection}: up to date`);
        continue;
      }
      pending += toCreate.length + toDrop.length;

      for (const index of toCreate) {
        console.log(`  ${collection}: + ${describe(index)}`);
      }
      // syncIndexes() drops anything the schema no longer declares, so an index
      // added by hand in the Atlas UI will disappear on the next run.
      for (const index of toDrop) {
        console.log(`  ${collection}: - ${describe(index)}`);
      }

      if (!dryRun) {
        const dropped = await model.syncIndexes();
        console.log(
          `  ${collection}: synced${dropped.length ? ` (dropped ${dropped.join(', ')})` : ''}`,
        );
      }
    }
  } finally {
    await mongoose.disconnect();
  }

  if (pending === 0) {
    console.log('Nothing to do.');
  } else if (dryRun) {
    console.log(`${pending} change(s) pending. Run "npm run db:indexes" to apply.`);
  } else {
    console.log(`Applied ${pending} change(s).`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
