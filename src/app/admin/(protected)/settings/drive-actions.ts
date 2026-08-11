"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { appendAudit } from "@/lib/sheets/payments";
import { upsertOperationalSettings } from "@/lib/sheets/settings";
import { validateDriveFolder } from "@/lib/storage/drive-client";
import { parseDriveFolderId, SLIP_STORAGE_FOLDER_SETTING, SLIP_STORAGE_VALIDATION_SETTING } from "@/lib/storage/drive-folder";
import type { DriveStorageActionResult } from "@/components/admin/drive-storage-form";

const safeDriveErrors = new Set([
  "Invalid Google Drive folder URL or ID.",
  "Folder not found. Share it with the service-account email and try again.",
  "Selected Drive item is not a folder.",
  "Selected Drive folder is in trash.",
  "Service account needs Editor access to this folder.",
  "Google service account is not configured correctly.",
  "Could not validate Google Drive folder. Try again.",
]);

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return safeDriveErrors.has(message) ? message : "Could not validate Google Drive folder. Try again.";
}

async function auditDrive(action: "DRIVE_STORAGE_UPDATED" | "DRIVE_STORAGE_TEST_FAILED", validatedAt: string): Promise<void> {
  try {
    await appendAudit({
      paymentId: "",
      clientId: "",
      action,
      previousStatus: SLIP_STORAGE_FOLDER_SETTING,
      newStatus: SLIP_STORAGE_FOLDER_SETTING,
      reason: action === "DRIVE_STORAGE_UPDATED" ? "Drive slip storage updated" : "Drive slip storage validation failed",
      source: "ADMIN",
      metadata: JSON.stringify({ settingKey: SLIP_STORAGE_FOLDER_SETTING, source: "ADMIN", validatedAt }),
    });
  } catch {}
}

export async function saveAndTestDriveFolderAction(formData: FormData): Promise<DriveStorageActionResult> {
  await requireAdmin();
  const attemptedAt = new Date().toISOString();
  try {
    const folderId = parseDriveFolderId(String(formData.get("folder") ?? ""));
    const validation = await validateDriveFolder(folderId);
    await upsertOperationalSettings([
      { key: SLIP_STORAGE_FOLDER_SETTING, value: validation.folderId },
      { key: SLIP_STORAGE_VALIDATION_SETTING, value: JSON.stringify({ status: "VALID", folderName: validation.folderName, validatedAt: validation.validatedAt }) },
    ]);
    await auditDrive("DRIVE_STORAGE_UPDATED", validation.validatedAt);
    revalidatePath("/admin/settings");
    return { ok: true, status: "VALID", message: "Google Drive folder connected.", folderName: validation.folderName, validatedAt: validation.validatedAt };
  } catch (error) {
    await auditDrive("DRIVE_STORAGE_TEST_FAILED", attemptedAt);
    return { ok: false, status: "FAILED", message: safeMessage(error), validatedAt: attemptedAt };
  }
}
