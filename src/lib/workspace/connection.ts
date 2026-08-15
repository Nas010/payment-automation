import { decryptSecret, encryptSecret } from "@/lib/secrets/crypto";
import { getSecretRecord, upsertSecretRecord } from "@/lib/secrets/repository";
import type { SecretKeyName } from "@/lib/secrets/types";
import type { GoogleWorkspaceConnection, PendingGoogleWorkspaceConnection } from "./types";

export const PENDING_WORKSPACE_CONNECTION_KEY = "google_workspace_pending" as const;
export const ACTIVE_WORKSPACE_CONNECTION_KEY = "google_workspace_connection" as const;

function validIdentity(value: Partial<PendingGoogleWorkspaceConnection>): boolean {
  return typeof value.refreshToken === "string" && value.refreshToken.length > 0
    && typeof value.accountGoogleSub === "string" && value.accountGoogleSub.trim().length > 0
    && typeof value.accountEmail === "string" && /^[^@\s]+@[^@\s]+$/.test(value.accountEmail);
}

function optionalResourceFieldsAreStrings(value: Partial<PendingGoogleWorkspaceConnection>): boolean {
  return [value.spreadsheetId, value.spreadsheetName, value.spreadsheetUrl, value.folderId, value.folderName, value.folderUrl]
    .every((field) => field === undefined || (typeof field === "string" && field.trim().length > 0));
}

function isPendingConnection(value: unknown): value is PendingGoogleWorkspaceConnection {
  return Boolean(value && typeof value === "object" && validIdentity(value as Partial<PendingGoogleWorkspaceConnection>) && optionalResourceFieldsAreStrings(value as Partial<PendingGoogleWorkspaceConnection>));
}

function isActiveConnection(value: unknown): value is GoogleWorkspaceConnection {
  if (!isPendingConnection(value)) return false;
  const connection = value as Partial<GoogleWorkspaceConnection>;
  return typeof connection.spreadsheetId === "string" && connection.spreadsheetId.length >= 10
    && typeof connection.spreadsheetName === "string" && connection.spreadsheetName.length > 0
    && typeof connection.spreadsheetUrl === "string" && connection.spreadsheetUrl.startsWith("https://")
    && typeof connection.folderId === "string" && connection.folderId.length >= 10
    && typeof connection.folderName === "string" && connection.folderName.length > 0
    && typeof connection.folderUrl === "string" && connection.folderUrl.startsWith("https://")
    && typeof connection.validatedAt === "string" && !Number.isNaN(Date.parse(connection.validatedAt));
}

async function readConnection(keyName: SecretKeyName): Promise<unknown | null> {
  const record = await getSecretRecord(keyName);
  if (!record) return null;
  try {
    return JSON.parse(decryptSecret({ keyName, record })) as unknown;
  } catch {
    throw new Error("Google Workspace connection is invalid.");
  }
}

async function writeConnection(keyName: typeof PENDING_WORKSPACE_CONNECTION_KEY | typeof ACTIVE_WORKSPACE_CONNECTION_KEY, value: object): Promise<void> {
  await upsertSecretRecord({
    keyName,
    ...encryptSecret({ keyName, plaintext: JSON.stringify(value), exposeLastFour: false }),
  });
}

export async function getPendingWorkspaceConnection(): Promise<PendingGoogleWorkspaceConnection | null> {
  const value = await readConnection(PENDING_WORKSPACE_CONNECTION_KEY);
  if (value === null) return null;
  if (!isPendingConnection(value)) throw new Error("Google Workspace connection is invalid.");
  return value;
}

export async function savePendingWorkspaceConnection(connection: PendingGoogleWorkspaceConnection): Promise<void> {
  if (!isPendingConnection(connection)) throw new Error("Google Workspace connection is invalid.");
  await writeConnection(PENDING_WORKSPACE_CONNECTION_KEY, {
    ...connection,
    accountEmail: connection.accountEmail.trim().toLowerCase(),
  });
}

export async function getActiveWorkspaceConnection(): Promise<GoogleWorkspaceConnection | null> {
  const value = await readConnection(ACTIVE_WORKSPACE_CONNECTION_KEY);
  if (value === null) return null;
  if (!isActiveConnection(value)) throw new Error("Google Workspace connection is invalid.");
  return value;
}

export async function activatePendingWorkspaceConnection(
  probes: { workbookProbePassed: boolean; folderProbePassed: boolean },
  now = new Date(),
): Promise<GoogleWorkspaceConnection> {
  if (!probes.workbookProbePassed || !probes.folderProbePassed) throw new Error("Both Google Workspace probes must pass before activation.");
  const pending = await getPendingWorkspaceConnection();
  const candidate = pending ? { ...pending, validatedAt: now.toISOString() } : null;
  if (!candidate || !isActiveConnection(candidate)) throw new Error("Google Workspace setup is incomplete.");
  await writeConnection(ACTIVE_WORKSPACE_CONNECTION_KEY, candidate);
  return candidate;
}
