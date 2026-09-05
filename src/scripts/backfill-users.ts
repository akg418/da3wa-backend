/**
 * Brings user documents up to the current shape:
 *
 *   local  -> username, passwordHash, authProviders (+ _id, timestamps)
 *   google -> username, email, googleId, authProviders (+ _id, timestamps)
 *
 * Earlier versions of this schema stored placeholders — first `''`, then
 * `null` — for the fields a flow had no value for. Those are removed, since a
 * partial unique index skips absent fields but a leftover placeholder is a real
 * value that two accounts would collide on. `displayName` and `avatarUrl` are
 * no longer part of the schema and are dropped wherever they appear.
 *
 * This is the data migration that index sync cannot infer. It must run *before*
 * `db:indexes`: `username` is uniquely indexed, and two legacy accounts without
 * one both index as null and fail the build.
 *
 * Works on the raw collection rather than the Mongoose model, since the model
 * would hide the very gaps this exists to close. Safe to run repeatedly.
 *
 *   npm run db:backfill:check   # report what would change
 *   npm run db:backfill         # apply it
 */
import mongoose from 'mongoose';
import {
  generatedUsername,
  usernameFromDisplayName,
  usernameWithSuffix,
} from '../modules/auth/username';

/** Kept only when they hold a real value; any placeholder is removed. */
const OPTIONAL_FIELDS = ['email', 'passwordHash', 'googleId'] as const;

/** No longer part of the schema. Removed wherever they appear. */
const DROPPED_FIELDS = ['displayName', 'avatarUrl'] as const;

function redact(uri: string): string {
  return uri.replace(/\/\/[^@]*@/, '//<credentials>@');
}

function isRealValue(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Picks a username not already spoken for, recording it so the run stays consistent. */
function allocate(displayName: unknown, taken: Set<string>): string {
  const base = usernameFromDisplayName(isRealValue(displayName) ? displayName : undefined);

  if (base && !taken.has(base)) {
    taken.add(base);
    return base;
  }
  // Same fallback order as a live Google sign-in, so a migrated account is
  // indistinguishable from one created today.
  for (;;) {
    const candidate = base ? usernameWithSuffix(base) : generatedUsername();
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is not set.');
  }
  if (uri === 'memory') {
    throw new Error('MONGODB_URI=memory has no data to migrate. Point it at a real database.');
  }

  console.log(`${dryRun ? 'Checking' : 'Backfilling'} users on ${redact(uri)}`);
  // Critical: autoIndex would try to build the new unique username index
  // against the very data this script exists to repair, and fail.
  await mongoose.connect(uri, { autoIndex: false });

  try {
    const users = mongoose.connection.db!.collection('users');
    const docs = await users.find({}).toArray();

    const taken = new Set(docs.map((doc) => doc.username).filter(isRealValue));
    const operations = [];

    for (const doc of docs) {
      const set: Record<string, unknown> = {};
      const unset: Record<string, ''> = {};

      for (const field of OPTIONAL_FIELDS) {
        if (field in doc && !isRealValue(doc[field])) {
          unset[field] = '';
        }
      }
      for (const field of DROPPED_FIELDS) {
        if (field in doc) {
          unset[field] = '';
        }
      }
      if (!Array.isArray(doc.authProviders)) {
        set.authProviders = [];
      }
      // Read displayName before it is dropped: it is what the username is
      // derived from, exactly as at a live sign-in.
      if (!isRealValue(doc.username)) {
        set.username = allocate(doc.displayName, taken);
      }

      const update: Record<string, unknown> = {};
      if (Object.keys(set).length > 0) {
        update.$set = set;
      }
      if (Object.keys(unset).length > 0) {
        update.$unset = unset;
      }
      if (Object.keys(update).length === 0) {
        continue;
      }

      const summary = [
        Object.keys(set).length > 0 ? `set ${JSON.stringify(set)}` : '',
        Object.keys(unset).length > 0 ? `remove ${Object.keys(unset).join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; ');
      console.log(`  ${doc._id.toString()}: ${summary}`);
      operations.push({ updateOne: { filter: { _id: doc._id }, update } });
    }

    if (operations.length === 0) {
      console.log(`Nothing to do (${docs.length} account(s) already current).`);
      return;
    }
    if (dryRun) {
      console.log(`${operations.length} of ${docs.length} account(s) would change.`);
      return;
    }

    const result = await users.bulkWrite(operations);
    console.log(`Updated ${result.modifiedCount} of ${docs.length} account(s).`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
