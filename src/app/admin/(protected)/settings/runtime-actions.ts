"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { parseRuntimeConfig, runtimeConfigEntries } from "@/lib/runtime-config";
import { upsertOperationalSettings } from "@/lib/sheets/settings";
import { createOAuthDriveClient, testDriveFolderWrite, validateDriveFolder } from "@/lib/storage/drive-client";
import { getPendingGoogleSheets } from "@/lib/sheets/client";
import { activatePendingWorkspaceConnection, getActiveWorkspaceConnection, savePendingWorkspaceConnection } from "@/lib/workspace/connection";
import { validateOperationalWorkbook } from "@/lib/workspace/workbook";

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

export async function saveRuntimeConfigAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const config = parseRuntimeConfig({
    businessDisplayName: String(formData.get("business_display_name") ?? ""),
    promptPayType: String(formData.get("promptpay_type") ?? ""),
    promptPayIdentifier: String(formData.get("promptpay_identifier") ?? ""),
    recipientNameEn: String(formData.get("recipient_name_en") ?? ""),
    recipientNameTh: String(formData.get("recipient_name_th") ?? ""),
    recipientAliases: String(formData.get("recipient_aliases") ?? "").split(","),
    publicBaseUrl: String(formData.get("public_base_url") ?? ""),
    slipRetentionDays: String(formData.get("slip_retention_days") ?? "30"),
    ocrEnabled: checked(formData, "ocr_enabled"),
    lineLiffId: String(formData.get("line_liff_id") ?? ""),
    lineLoginChannelId: String(formData.get("line_login_channel_id") ?? ""),
    lineLinkingEnabled: checked(formData, "line_linking_enabled"),
    lineMessagingEnabled: checked(formData, "line_messaging_enabled"),
    lineChatPaymentsEnabled: checked(formData, "line_chat_payments_enabled"),
  });
  await upsertOperationalSettings(runtimeConfigEntries(config));
  revalidatePath("/admin/settings");
}

export async function testWorkspaceConnectionAction(): Promise<void> {
  await requireAdmin();
  const active = await getActiveWorkspaceConnection();
  if (!active) throw new Error("Google Workspace is not connected.");
  await savePendingWorkspaceConnection({
    refreshToken: active.refreshToken,
    accountGoogleSub: active.accountGoogleSub,
    accountEmail: active.accountEmail,
    spreadsheetId: active.spreadsheetId,
    spreadsheetName: active.spreadsheetName,
    spreadsheetUrl: active.spreadsheetUrl,
    folderId: active.folderId,
    folderName: active.folderName,
    folderUrl: active.folderUrl,
  });
  const pending = await getPendingGoogleSheets();
  await validateOperationalWorkbook(active.spreadsheetId, pending.sheets);
  const drive = createOAuthDriveClient(active);
  await validateDriveFolder(active.folderId, { drive, permissionMessage: "Connected Google account needs Editor access to this folder." });
  await testDriveFolderWrite(active.folderId, drive);
  await activatePendingWorkspaceConnection({ workbookProbePassed: true, folderProbePassed: true });
  revalidatePath("/admin/settings");
}
