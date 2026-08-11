import { listOperationalSettings, type OperationalSetting } from "@/lib/sheets/settings";
import { getGoogleDriveConnection, type GoogleDriveConnection } from "./google-drive-connection";

export const SLIP_STORAGE_FOLDER_SETTING = "slip_storage_folder_id";
export const SLIP_STORAGE_VALIDATION_SETTING = "slip_storage_validation";

export type SlipStorageFolder = { folderId: string; source: "oauth" | "workbook" | "environment"; folderName?: string };

const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

export function parseDriveFolderId(value: string): string {
  const trimmed = value.trim();
  if (DRIVE_ID_PATTERN.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    const standardFolderId = segments.length === 3 && segments[0] === "drive" && segments[1] === "folders" ? segments[2] : "";
    const accountFolderId = segments.length === 5 && segments[0] === "drive" && segments[1] === "u" && /^\d+$/.test(segments[2] ?? "") && segments[3] === "folders" ? segments[4] : "";
    const folderId = standardFolderId || accountFolderId;
    if (url.protocol === "https:" && url.hostname === "drive.google.com" && DRIVE_ID_PATTERN.test(folderId)) return folderId;
  } catch {}

  throw new Error("Invalid Google Drive folder URL or ID.");
}

export function serviceAccountEmail(serviceAccountJson: string): string {
  try {
    const parsed = JSON.parse(serviceAccountJson) as { client_email?: unknown };
    if (typeof parsed.client_email === "string" && /^[^@\s]+@[^@\s]+$/.test(parsed.client_email)) return parsed.client_email;
  } catch {}
  throw new Error("Google service account is not configured correctly.");
}

export function selectSlipStorageFolderId(settings: Array<Pick<OperationalSetting, "key" | "value">>, environment: Record<string, string | undefined>): SlipStorageFolder | null {
  const workbookValue = settings.find((item) => item.key === SLIP_STORAGE_FOLDER_SETTING)?.value.trim();
  if (workbookValue) return { folderId: workbookValue, source: "workbook" };
  const environmentValue = environment.SLIP_STORAGE_FOLDER_ID?.trim();
  if (environmentValue && environmentValue !== "CONFIG_REQUIRED") return { folderId: environmentValue, source: "environment" };
  return null;
}

export async function getSlipStorageFolder({
  listSettings = listOperationalSettings,
  environment = process.env,
  getGoogleDriveConnection: resolveConnection = getGoogleDriveConnection,
}: {
  listSettings?: () => Promise<OperationalSetting[]>;
  environment?: Record<string, string | undefined>;
  getGoogleDriveConnection?: () => Promise<GoogleDriveConnection | null>;
} = {}): Promise<SlipStorageFolder> {
  try {
    const connection = await resolveConnection();
    if (connection) return { folderId: connection.folderId, source: "oauth", folderName: connection.folderName };
  } catch {}
  let settings: OperationalSetting[] = [];
  try {
    settings = await listSettings();
  } catch {}
  const selected = selectSlipStorageFolderId(settings, environment);
  if (!selected) throw new Error("Slip storage folder is not configured.");
  return selected;
}
