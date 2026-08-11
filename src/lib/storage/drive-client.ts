import { Readable } from "node:stream";
import { google } from "googleapis";
import { serviceAccountEmail } from "./drive-folder";

type DriveFolderMetadata = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  trashed?: boolean | null;
  capabilities?: { canAddChildren?: boolean | null } | null;
};

export type DriveClientLike = {
  files: {
    get: (input: { fileId: string; fields: string; supportsAllDrives: boolean }) => Promise<{ data: DriveFolderMetadata }>;
    create: (input: {
      requestBody: { name: string; parents: string[]; mimeType: string };
      media: { mimeType: string; body: Readable };
      fields: string;
      supportsAllDrives: boolean;
    }) => Promise<{ data: { id?: string | null } }>;
  };
};

export function createDriveClient(serviceAccountJson: string = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? ""): DriveClientLike {
  serviceAccountEmail(serviceAccountJson);
  let credentials: Record<string, string>;
  try {
    credentials = JSON.parse(serviceAccountJson) as Record<string, string>;
  } catch {
    throw new Error("Google service account is not configured correctly.");
  }
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/drive.file"] });
  return google.drive({ version: "v3", auth }) as unknown as DriveClientLike;
}

function googleStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "number") return direct;
  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === "number" ? response.status : null;
}

export async function validateDriveFolder(folderId: string, {
  drive = createDriveClient(),
  now = () => new Date().toISOString(),
}: {
  drive?: DriveClientLike;
  now?: () => string;
} = {}): Promise<{ folderId: string; folderName: string; validatedAt: string }> {
  let folder: DriveFolderMetadata;
  try {
    const response = await drive.files.get({ fileId: folderId, fields: "id,name,mimeType,trashed,capabilities(canAddChildren)", supportsAllDrives: true });
    folder = response.data;
  } catch (error) {
    if (googleStatus(error) === 404) throw new Error("Folder not found. Share it with the service-account email and try again.");
    throw new Error("Could not validate Google Drive folder. Try again.");
  }

  if (folder.mimeType !== "application/vnd.google-apps.folder") throw new Error("Selected Drive item is not a folder.");
  if (folder.trashed) throw new Error("Selected Drive folder is in trash.");
  if (folder.capabilities?.canAddChildren !== true) throw new Error("Service account needs Editor access to this folder.");
  return { folderId, folderName: folder.name?.trim() || "Google Drive folder", validatedAt: now() };
}

export async function createDriveSlipFile(input: {
  bytes: Uint8Array;
  mimeType: string;
  paymentId: string;
  imageHash: string;
  folderId: string;
}, { drive = createDriveClient() }: { drive?: DriveClientLike } = {}): Promise<string> {
  const created = await drive.files.create({
    requestBody: { name: `slip-${input.paymentId}-${input.imageHash.slice(0, 12)}`, parents: [input.folderId], mimeType: input.mimeType },
    media: { mimeType: input.mimeType, body: Readable.from(Buffer.from(input.bytes)) },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error("Private slip storage did not return a file ID");
  return created.data.id;
}
