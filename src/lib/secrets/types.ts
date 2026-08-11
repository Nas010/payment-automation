export const SECRET_KEY_NAMES = ["line_channel_access_token", "line_channel_secret", "google_drive_connection"] as const;
export const LINE_SECRET_KEY_NAMES = ["line_channel_access_token", "line_channel_secret"] as const;

export type SecretKeyName = (typeof SECRET_KEY_NAMES)[number];
export type LineSecretKeyName = (typeof LINE_SECRET_KEY_NAMES)[number];

export type EncryptedSecretPayload = {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: "aes-256-gcm";
  keyVersion: string;
  createdAt: string;
  updatedAt: string;
  lastFour: string;
};

export type EncryptedSecretRecord = EncryptedSecretPayload & {
  rowNumber: number;
  keyName: SecretKeyName;
};

export type SecretMetadata = Pick<EncryptedSecretRecord, "rowNumber" | "keyName" | "algorithm" | "keyVersion" | "createdAt" | "updatedAt" | "lastFour">;
