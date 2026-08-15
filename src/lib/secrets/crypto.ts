import "./server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EncryptedSecretPayload, SecretKeyName } from "./types";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function encryptionKey(environment: Record<string, string | undefined> = process.env): Buffer {
  const encoded = environment.SETTINGS_ENCRYPTION_KEY;
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be base64-encoded 32 bytes");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be base64-encoded 32 bytes");
  }
  return key;
}

function aad(keyName: SecretKeyName): Buffer {
  return Buffer.from(keyName, "utf8");
}

function encryptBytes(plaintext: string, authenticatedContext: Buffer): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(authenticatedContext);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decryptBytes(input: { ciphertext: Buffer; iv: Buffer; authTag: Buffer; authenticatedContext: Buffer }): string {
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), input.iv);
  decipher.setAAD(input.authenticatedContext);
  decipher.setAuthTag(input.authTag);
  return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]).toString("utf8");
}

export function encryptSecret({ keyName, plaintext, exposeLastFour = true }: { keyName: SecretKeyName; plaintext: string; exposeLastFour?: boolean }): EncryptedSecretPayload {
  const { ciphertext, iv, authTag } = encryptBytes(plaintext, aad(keyName));
  const now = new Date().toISOString();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    algorithm: ALGORITHM,
    keyVersion: "1",
    createdAt: now,
    updatedAt: now,
    lastFour: exposeLastFour ? plaintext.slice(-4) : "",
  };
}

export function decryptSecret({ keyName, record }: { keyName: SecretKeyName; record: Pick<EncryptedSecretPayload, "ciphertext" | "iv" | "authTag" | "algorithm"> }): string {
  try {
    if (record.algorithm !== ALGORITHM) throw new Error("Unsupported algorithm");
    return decryptBytes({
      ciphertext: Buffer.from(record.ciphertext, "base64"),
      iv: Buffer.from(record.iv, "base64"),
      authTag: Buffer.from(record.authTag, "base64"),
      authenticatedContext: aad(keyName),
    });
  } catch {
    throw new Error("Secret record authentication failed");
  }
}

/** Encrypts a workbook-owned private value using existing deployment key. */
export function encryptPrivateValue({ context, plaintext }: { context: string; plaintext: string }): string {
  if (!context) throw new Error("Private value context is required");
  const { ciphertext, iv, authTag } = encryptBytes(plaintext, Buffer.from(context, "utf8"));
  return ["v1", iv.toString("base64url"), ciphertext.toString("base64url"), authTag.toString("base64url")].join(".");
}

/** Decrypts only when ciphertext remains bound to same operational context. */
export function decryptPrivateValue({ context, encrypted }: { context: string; encrypted: string }): string {
  try {
    const [version, iv, ciphertext, authTag, extra] = encrypted.split(".");
    if (version !== "v1" || !iv || !ciphertext || !authTag || extra !== undefined) throw new Error("Malformed private value");
    return decryptBytes({
      ciphertext: Buffer.from(ciphertext, "base64url"),
      iv: Buffer.from(iv, "base64url"),
      authTag: Buffer.from(authTag, "base64url"),
      authenticatedContext: Buffer.from(context, "utf8"),
    });
  } catch {
    throw new Error("Private value authentication failed");
  }
}
