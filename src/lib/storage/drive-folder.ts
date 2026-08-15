import { getActiveWorkspaceConnection } from "@/lib/workspace/connection";

export type SlipStorageFolder = { folderId: string; source: "oauth"; folderName: string };

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

export async function getSlipStorageFolder(): Promise<SlipStorageFolder> {
  const connection = await getActiveWorkspaceConnection();
  if (!connection) throw new Error("Slip storage folder is not configured.");
  return { folderId: connection.folderId, source: "oauth", folderName: connection.folderName };
}
