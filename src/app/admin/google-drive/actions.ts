"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { setInstallationStatus } from "@/lib/installation/repository";
import { appendAudit } from "@/lib/sheets/payments";
import { parseDriveFolderId } from "@/lib/storage/drive-folder";
import { createOAuthDriveClient, testDriveFolderWrite, validateDriveFolder } from "@/lib/storage/drive-client";
import { googleDriveConfig } from "@/lib/storage/google-drive-auth";
import { getPendingGoogleSheets } from "@/lib/sheets/client";
import { activatePendingWorkspaceConnection, getActiveWorkspaceConnection, getPendingWorkspaceConnection, savePendingWorkspaceConnection } from "@/lib/workspace/connection";
import { validateOperationalWorkbook } from "@/lib/workspace/workbook";

export type GoogleDriveConnectionActionResult = {
  ok: boolean;
  status: "CONNECTED" | "FAILED";
  message: string;
  accountEmail?: string;
  folderName?: string;
  validatedAt?: string;
};

const safeErrors = new Set([
  "Invalid Google Drive folder URL or ID.",
  "Selected Drive item is not a folder.",
  "Selected Drive folder is in trash.",
  "Connected Google account needs Editor access to this folder.",
  "Could not validate Google Drive folder. Try again.",
  "Google Drive OAuth is not configured.",
  "Google Drive connection is invalid.",
  "Google Drive connection is not connected.",
  "Google Drive connection needs attention.",
]);

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return safeErrors.has(message) ? message : "Could not connect Google Drive. Try again.";
}

async function auditDrive(success: boolean, validatedAt: string): Promise<void> {
  try {
    await appendAudit({
      paymentId: "",
      clientId: "",
      action: success ? "DRIVE_STORAGE_UPDATED" : "DRIVE_STORAGE_TEST_FAILED",
      previousStatus: "DRIVE_STORAGE",
      newStatus: "DRIVE_STORAGE",
      reason: success ? "Google Drive OAuth folder connected" : "Google Drive OAuth folder validation failed",
      source: "ADMIN",
      metadata: JSON.stringify({ source: "GOOGLE_OAUTH", validatedAt }),
    });
  } catch {}
}

function failure(message: string): GoogleDriveConnectionActionResult {
  return { ok: false, status: "FAILED", message, validatedAt: new Date().toISOString() };
}

export async function activateGoogleDriveFolderAction(formData: FormData): Promise<GoogleDriveConnectionActionResult> {
  const session = await requireAdmin();
  const attemptedAt = new Date().toISOString();
  try {
    const folderId = parseDriveFolderId(String(formData.get("folder_id") ?? ""));
    const folderName = String(formData.get("folder_name") ?? "").trim();
    if (!folderName) return failure("Selected Drive item is not a folder.");

    const [pending, active] = await Promise.all([getPendingWorkspaceConnection(), getActiveWorkspaceConnection()]);
    const authorization = pending ?? active;
    if (!authorization) return failure("Google Drive connection is not connected.");

    const config = googleDriveConfig();
    if (!config) return failure("Google Drive OAuth is not configured.");
    const drive = createOAuthDriveClient(authorization, config);
    const validation = await validateDriveFolder(folderId, { drive, permissionMessage: "Connected Google account needs Editor access to this folder." });
    await testDriveFolderWrite(folderId, drive);

    const staged = {
      ...(active ?? {}),
      ...authorization,
      folderId: validation.folderId,
      folderName: validation.folderName,
      folderUrl: `https://drive.google.com/drive/folders/${validation.folderId}`,
    };
    await savePendingWorkspaceConnection(staged);
    if (active && staged.spreadsheetId) {
      const pendingSheets = await getPendingGoogleSheets();
      await validateOperationalWorkbook(staged.spreadsheetId, pendingSheets.sheets);
      await activatePendingWorkspaceConnection({ workbookProbePassed: true, folderProbePassed: true });
    } else if (staged.spreadsheetId) {
      await setInstallationStatus(session.sub, "WORKSPACE_CONNECTED");
    }
    await auditDrive(true, validation.validatedAt);
    revalidatePath("/admin/settings");
    return { ok: true, status: "CONNECTED", message: "Google Drive folder connected.", accountEmail: authorization.accountEmail, folderName: validation.folderName, validatedAt: validation.validatedAt };
  } catch (error) {
    await auditDrive(false, attemptedAt);
    return failure(safeMessage(error));
  }
}
