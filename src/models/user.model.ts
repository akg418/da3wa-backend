import { Schema, model, type Document, type Model } from 'mongoose';

export type AuthProvider = 'local' | 'google';

export interface IUser {
  username?: string;
  email?: string;
  passwordHash?: string;
  googleId?: string;
  displayName?: string;
  avatarUrl?: string;
  authProviders: AuthProvider[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserDocument extends IUser, Document {}

const userSchema = new Schema<IUserDocument>(
  {
    username: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      select: false,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    displayName: String,
    avatarUrl: String,
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

export const User: Model<IUserDocument> = model<IUserDocument>('User', userSchema);
