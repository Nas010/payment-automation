import { decryptSecret, encryptSecret } from "@/lib/secrets/crypto";
import { getSecretRecord, upsertSecretRecord } from "@/lib/secrets/repository";
import { GOOGLE_DRIVE_CONNECTION_KEY } from "./google-drive-auth";

export type GoogleDriveConnection = {
  refreshToken: string;
  accountEmail: string;
  folderId: string;
  folderName: string;
  validatedAt: string;
};

function isConnection(value: unknown): value is GoogleDriveConnection {
  if (!value || typeof value !== "object") return false;
  const connection = value as Partial<GoogleDriveConnection>;
  return typeof connection.refreshToken === "string" && connection.refreshToken.length > 0
    && typeof connection.accountEmail === "string" && /^[^@\s]+@[^@\s]+$/.test(connection.accountEmail)
    && typeof connection.folderId === "string" && connection.folderId.length >= 10
    && typeof connection.folderName === "string" && connection.folderName.trim().length > 0
    && typeof connection.validatedAt === "string" && !Number.isNaN(Date.parse(connection.validatedAt));
}

export async function getGoogleDriveConnection(): Promise<GoogleDriveConnection | null> {
  const record = await getSecretRecord(GOOGLE_DRIVE_CONNECTION_KEY);
  if (!record) return null;
  try {
    const connection: unknown = JSON.parse(decryptSecret({ keyName: GOOGLE_DRIVE_CONNECTION_KEY, record }));
    if (!isConnection(connection)) throw new Error("invalid connection");
    return connection;
  } catch {
    throw new Error("Google Drive connection is invalid.");
  }
}

export async function saveGoogleDriveConnection(connection: GoogleDriveConnection): Promise<void> {
  if (!isConnection(connection)) throw new Error("Google Drive connection is invalid.");
  await upsertSecretRecord({
    keyName: GOOGLE_DRIVE_CONNECTION_KEY,
    ...encryptSecret({
      keyName: GOOGLE_DRIVE_CONNECTION_KEY,
      plaintext: JSON.stringify(connection),
      exposeLastFour: false,
    }),
  });
}

export function googleDriveStatus(connection: GoogleDriveConnection | null): {
  connected: boolean;
  accountEmail?: string;
  folderName?: string;
  validatedAt?: string;
} {
  if (!connection) return { connected: false };
  return {
    connected: true,
    accountEmail: connection.accountEmail,
    folderName: connection.folderName,
    validatedAt: connection.validatedAt,
  };
}
