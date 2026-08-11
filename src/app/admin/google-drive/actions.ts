"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { appendAudit } from "@/lib/sheets/payments";
import { parseDriveFolderId } from "@/lib/storage/drive-folder";
import { createOAuthDriveClient, testDriveFolderWrite, validateDriveFolder } from "@/lib/storage/drive-client";
import {
  decodeDriveCandidate,
  googleDriveConfig,
} from "@/lib/storage/google-drive-auth";
import { getGoogleDriveConnection, saveGoogleDriveConnection } from "@/lib/storage/google-drive-connection";

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
  await requireAdmin();
  const attemptedAt = new Date().toISOString();
  const cookieStore = await cookies();
  try {
    const folderId = parseDriveFolderId(String(formData.get("folder_id") ?? ""));
    const folderName = String(formData.get("folder_name") ?? "").trim();
    if (!folderName) return failure("Selected Drive item is not a folder.");

    const candidateCookie = cookieStore.get("google_drive_candidate")?.value;
    const candidate = candidateCookie ? decodeDriveCandidate(candidateCookie) : null;
    const active = candidate ? null : await getGoogleDriveConnection();
    const authorization = candidate ?? active;
    if (!authorization) return failure("Google Drive connection is not connected.");

    const config = googleDriveConfig();
    if (!config) return failure("Google Drive OAuth is not configured.");
    const drive = createOAuthDriveClient(authorization, config);
    const validation = await validateDriveFolder(folderId, { drive, permissionMessage: "Connected Google account needs Editor access to this folder." });
    await testDriveFolderWrite(folderId, drive);

    await saveGoogleDriveConnection({
      refreshToken: authorization.refreshToken,
      accountEmail: authorization.accountEmail,
      folderId: validation.folderId,
      folderName: validation.folderName,
      validatedAt: validation.validatedAt,
    });
    if (candidateCookie) cookieStore.delete("google_drive_candidate");
    await auditDrive(true, validation.validatedAt);
    revalidatePath("/admin/settings");
    return { ok: true, status: "CONNECTED", message: "Google Drive folder connected.", accountEmail: authorization.accountEmail, folderName: validation.folderName, validatedAt: validation.validatedAt };
  } catch (error) {
    await auditDrive(false, attemptedAt);
    return failure(safeMessage(error));
  }
}
