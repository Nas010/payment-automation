import { Readable } from "node:stream";
import { google } from "googleapis";
import { googleDriveConfig, googleDriveRedirectUri, type GoogleDriveConfig } from "@/lib/config";
import { createGoogleDriveOAuthClient } from "./google-drive-auth";
import { getActiveWorkspaceConnection } from "@/lib/workspace/connection";

type DriveFolderMetadata = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  trashed?: boolean | null;
  capabilities?: { canAddChildren?: boolean | null } | null;
};

export type DriveClientLike = {
  files: {
    get: (
      input: { fileId: string; fields?: string; supportsAllDrives?: boolean; alt?: string },
      options?: { responseType: "arraybuffer" },
    ) => Promise<{ data: DriveFolderMetadata | ArrayBuffer | Uint8Array; headers?: Record<string, string | undefined> }>;
    create: (input: {
      requestBody: { name: string; parents?: string[]; mimeType: string };
      media?: { mimeType: string; body: Readable };
      fields: string;
      supportsAllDrives: boolean;
    }) => Promise<{ data: { id?: string | null } }>;
    delete?: (input: { fileId: string; supportsAllDrives: boolean }) => Promise<unknown>;
  };
};

export function createOAuthDriveClient(connection: { refreshToken: string }, config: GoogleDriveConfig = googleDriveConfig() ?? (() => { throw new Error("Google Drive OAuth is not configured."); })()): DriveClientLike {
  const redirectUri = googleDriveRedirectUri("http://localhost:3000");
  const auth = createGoogleDriveOAuthClient({ config, redirectUri });
  auth.setCredentials({ refresh_token: connection.refreshToken });
  return google.drive({ version: "v3", auth }) as unknown as DriveClientLike;
}

export async function getConfiguredDriveClient(): Promise<DriveClientLike> {
  const connection = await getActiveWorkspaceConnection();
  if (!connection) throw new Error("Google Workspace is not connected.");
  return createOAuthDriveClient(connection);
}

function googleStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "number") return direct;
  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === "number" ? response.status : null;
}

export async function validateDriveFolder(folderId: string, {
  drive,
  now = () => new Date().toISOString(),
  permissionMessage = "Connected Google account needs Editor access to this folder.",
}: {
  drive: DriveClientLike;
  now?: () => string;
  permissionMessage?: string;
}): Promise<{ folderId: string; folderName: string; validatedAt: string }> {
  let folder: DriveFolderMetadata;
  try {
    const response = await drive.files.get({ fileId: folderId, fields: "id,name,mimeType,trashed,capabilities(canAddChildren)", supportsAllDrives: true });
    folder = response.data as DriveFolderMetadata;
  } catch (error) {
    if (googleStatus(error) === 404) throw new Error("Folder not found. Choose a folder available to the connected Google account.");
    throw new Error("Could not validate Google Drive folder. Try again.");
  }

  if (folder.mimeType !== "application/vnd.google-apps.folder") throw new Error("Selected Drive item is not a folder.");
  if (folder.trashed) throw new Error("Selected Drive folder is in trash.");
  if (folder.capabilities?.canAddChildren !== true) throw new Error(permissionMessage);
  return { folderId, folderName: folder.name?.trim() || "Google Drive folder", validatedAt: now() };
}

export async function testDriveFolderWrite(folderId: string, drive: DriveClientLike, {
  now = () => new Date().toISOString(),
}: {
  now?: () => string;
} = {}): Promise<void> {
  if (!drive.files.delete) throw new Error("Could not validate Google Drive folder. Try again.");
  const safeTimestamp = now().replace(/[:.]/g, "-");
  try {
    const created = await drive.files.create({
      requestBody: { name: "coaching-payments-drive-probe-" + safeTimestamp, parents: [folderId], mimeType: "text/plain" },
      media: { mimeType: "text/plain", body: Readable.from(Buffer.alloc(0)) },
      fields: "id",
      supportsAllDrives: true,
    });
    const probeId = created.data.id ?? "";
    if (!probeId) throw new Error("probe id missing");
    await drive.files.delete({ fileId: probeId, supportsAllDrives: true });
  } catch {
    throw new Error("Could not validate Google Drive folder. Try again.");
  }
}

export async function createDriveFolder(name: string, drive: DriveClientLike): Promise<{ folderId: string; folderName: string; folderUrl: string }> {
  const folderName = name.trim();
  if (!folderName) throw new Error("Drive folder name is required.");
  try {
    const created = await drive.files.create({
      requestBody: { name: folderName, mimeType: "application/vnd.google-apps.folder" },
      fields: "id",
      supportsAllDrives: true,
    });
    const folderId = created.data.id;
    if (!folderId) throw new Error("folder id missing");
    return { folderId, folderName, folderUrl: `https://drive.google.com/drive/folders/${folderId}` };
  } catch {
    throw new Error("Could not create Google Drive folder. Try again.");
  }
}

export async function createDriveSlipFile(input: {
  bytes: Uint8Array;
  mimeType: string;
  paymentId: string;
  imageHash: string;
  folderId: string;
}, { drive }: { drive?: DriveClientLike } = {}): Promise<string> {
  const configuredDrive = drive ?? await getConfiguredDriveClient();
  const created = await configuredDrive.files.create({
    requestBody: { name: `slip-${input.paymentId}-${input.imageHash.slice(0, 12)}`, parents: [input.folderId], mimeType: input.mimeType },
    media: { mimeType: input.mimeType, body: Readable.from(Buffer.from(input.bytes)) },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error("Private slip storage did not return a file ID");
  return created.data.id;
}

export async function createDriveTermsImageFile(input: {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  versionId: string;
  folderId: string;
}, { drive }: { drive?: DriveClientLike } = {}): Promise<string> {
  try {
    const configuredDrive = drive ?? await getConfiguredDriveClient();
    const extension = input.mimeType === "image/png" ? "png" : "jpg";
    const created = await configuredDrive.files.create({
      requestBody: { name: `line-terms-${input.versionId}.${extension}`, parents: [input.folderId], mimeType: input.mimeType },
      media: { mimeType: input.mimeType, body: Readable.from(Buffer.from(input.bytes)) },
      fields: "id",
      supportsAllDrives: true,
    });
    if (!created.data.id) throw new Error("missing file id");
    return created.data.id;
  } catch {
    throw new Error("Could not store T&S image. Try again.");
  }
}

export async function readDriveTermsImageFile(fileId: string, { drive }: { drive?: DriveClientLike } = {}): Promise<{ bytes: Uint8Array; declaredMimeType: string }> {
  try {
    const configuredDrive = drive ?? await getConfiguredDriveClient();
    const file = await configuredDrive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    const bytes = file.data instanceof ArrayBuffer
      ? new Uint8Array(file.data)
      : file.data instanceof Uint8Array
        ? new Uint8Array(file.data)
        : null;
    if (!bytes) throw new Error("invalid media body");
    return { bytes, declaredMimeType: file.headers?.["content-type"] ?? "" };
  } catch {
    throw new Error("T&S image is unavailable.");
  }
}
