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

export function encryptSecret({ keyName, plaintext }: { keyName: SecretKeyName; plaintext: string }): EncryptedSecretPayload {
  const key = encryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad(keyName));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const now = new Date().toISOString();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    algorithm: ALGORITHM,
    keyVersion: "1",
    createdAt: now,
    updatedAt: now,
    lastFour: plaintext.slice(-4),
  };
}

export function decryptSecret({ keyName, record }: { keyName: SecretKeyName; record: Pick<EncryptedSecretPayload, "ciphertext" | "iv" | "authTag" | "algorithm"> }): string {
  const key = encryptionKey();
  try {
    if (record.algorithm !== ALGORITHM) throw new Error("Unsupported algorithm");
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, "base64"));
    decipher.setAAD(aad(keyName));
    decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Secret record authentication failed");
  }
}
