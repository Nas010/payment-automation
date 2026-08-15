import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { googleDriveConfig, googleDriveRedirectUri, type GoogleDriveConfig } from "@/lib/config";
export const googleDriveScopes = ["https://www.googleapis.com/auth/drive.file", "openid", "email"] as const;

export type GoogleDriveOAuthClientInput = {
  config: GoogleDriveConfig;
  redirectUri: string;
};

export function createGoogleDriveOAuthClient({ config, redirectUri }: GoogleDriveOAuthClientInput): OAuth2Client {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, redirectUri);
}

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function createOAuthNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function createPkceVerifier(): string {
  return randomBytes(64).toString("base64url");
}

export function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function isEqualOAuthState(expected: string | undefined, received: string | undefined): boolean {
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function verifyGoogleIdentity(client: OAuth2Client, {
  idToken,
  expectedNonce,
  clientId,
}: {
  idToken: string;
  expectedNonce: string;
  clientId: string;
}): Promise<{ googleSub: string; email: string }> {
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    const email = payload?.email?.trim().toLowerCase();
    if (!payload?.sub || payload.nonce !== expectedNonce || payload.email_verified !== true || !email || !/^[^@\s]+@[^@\s]+$/.test(email)) {
      throw new Error("invalid identity");
    }
    return { googleSub: payload.sub, email };
  } catch {
    throw new Error("Google identity could not be verified.");
  }
}

export { googleDriveConfig, googleDriveRedirectUri };
