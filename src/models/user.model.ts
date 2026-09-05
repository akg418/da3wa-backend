import { Schema, model, type Document, type Model } from 'mongoose';

export type AuthProvider = 'local' | 'google';

/**
 * Each flow stores only the fields it actually has, so nothing is written as a
 * placeholder:
 *
 *   local  -> username, passwordHash, authProviders (+ _id, timestamps)
 *   google -> username, email, googleId, authProviders (+ _id, timestamps)
 *
 * The optional fields carry no default, which is what keeps them absent rather
 * than null on the accounts that have no such identity.
 */
export interface IUser {
  username: string;
  email?: string;
  passwordHash?: string;
  googleId?: string;
  authProviders: AuthProvider[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserDocument extends IUser, Document {}

const userSchema = new Schema<IUserDocument>(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      select: false,
    },
    googleId: {
      type: String,
    },
    authProviders: {
      type: [String],
      enum: ['local', 'google'],
      required: true,
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

// Both flows always produce a username, so this one is unconditionally unique.
userSchema.index({ username: 1 }, { unique: true });

// Partial rather than sparse. Sparse would be enough for a field that is truly
// absent, but it indexes any value that is *present* — including the nulls and
// empty strings left on this collection by earlier versions of the schema, and
// two of those collide. `{ $gt: '' }` matches non-empty strings only, so absent,
// null and '' are all excluded while real values stay unique.
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $gt: '' } } });
userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $gt: '' } } },
);

export const User: Model<IUserDocument> = model<IUserDocument>('User', userSchema);
