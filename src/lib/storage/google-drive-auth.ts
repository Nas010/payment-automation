import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { googleDriveConfig, googleDriveRedirectUri, type GoogleDriveConfig } from "@/lib/config";
import { decryptSecret, encryptSecret } from "@/lib/secrets/crypto";
import type { EncryptedSecretPayload } from "@/lib/secrets/types";

export const GOOGLE_DRIVE_CONNECTION_KEY = "google_drive_connection" as const;
export const googleDriveScopes = ["https://www.googleapis.com/auth/drive.file", "openid", "email"] as const;

export type GoogleDriveCandidate = {
  refreshToken: string;
  accountEmail: string;
};

export type GoogleDriveOAuthClientInput = {
  config: GoogleDriveConfig;
  redirectUri: string;
};

export function createGoogleDriveOAuthClient({ config, redirectUri }: GoogleDriveOAuthClientInput): OAuth2Client {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, redirectUri);
}

export async function getGoogleAccountEmail(client: OAuth2Client): Promise<string> {
  const response = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  const email = response.data.email?.trim();
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("Google account email is unavailable.");
  return email;
}

export function createOAuthState(): string {
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

function isCandidate(value: unknown): value is GoogleDriveCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GoogleDriveCandidate>;
  return typeof candidate.refreshToken === "string" && candidate.refreshToken.length > 0
    && typeof candidate.accountEmail === "string" && /^[^@\s]+@[^@\s]+$/.test(candidate.accountEmail);
}

export function encodeDriveCandidate(candidate: GoogleDriveCandidate): string {
  if (!isCandidate(candidate)) throw new Error("Google Drive connection is invalid.");
  const encrypted = encryptSecret({
    keyName: GOOGLE_DRIVE_CONNECTION_KEY,
    plaintext: JSON.stringify(candidate),
    exposeLastFour: false,
  });
  return Buffer.from(JSON.stringify(encrypted), "utf8").toString("base64url");
}

export function decodeDriveCandidate(value: string): GoogleDriveCandidate {
  try {
    const record = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as EncryptedSecretPayload;
    const plaintext = decryptSecret({ keyName: GOOGLE_DRIVE_CONNECTION_KEY, record });
    const candidate: unknown = JSON.parse(plaintext);
    if (!isCandidate(candidate)) throw new Error("invalid candidate");
    return candidate;
  } catch {
    throw new Error("Google Drive connection is invalid.");
  }
}

export { googleDriveConfig, googleDriveRedirectUri };
