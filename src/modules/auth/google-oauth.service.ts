import { randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { AppError, ErrorCode } from '../../utils/errors';

export interface GoogleProfile {
  googleId: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
}

let oauthClient: OAuth2Client | null = null;

function getOAuthClient(): OAuth2Client {
  if (!oauthClient) {
    oauthClient = new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_CALLBACK_URL,
    );
  }
  return oauthClient;
}

export function generateOAuthState(): string {
  return randomBytes(32).toString('hex');
}

export function getGoogleAuthorizationUrl(state: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
  });
}

export async function exchangeGoogleCode(code: string): Promise<GoogleProfile> {
  const client = getOAuthClient();

  try {
    const { tokens } = await client.getToken(code);

    if (!tokens.id_token) {
      throw new AppError(ErrorCode.OAUTH_ERROR, 'Google authentication failed', 401);
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new AppError(ErrorCode.OAUTH_ERROR, 'Google authentication failed', 401);
    }

    return {
      googleId: payload.sub,
      email: payload.email.toLowerCase(),
      displayName: payload.name,
      avatarUrl: payload.picture,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(ErrorCode.OAUTH_ERROR, 'Google authentication failed', 401);
  }
}

export function resetOAuthClient(): void {
  oauthClient = null;
}
