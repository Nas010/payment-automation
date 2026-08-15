"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { setInstallationStatus } from "@/lib/installation/repository";
import { parseRuntimeConfig } from "@/lib/runtime-config";
import { createDriveFolder, createOAuthDriveClient, testDriveFolderWrite, validateDriveFolder } from "@/lib/storage/drive-client";
import { getPendingWorkspaceConnection, savePendingWorkspaceConnection } from "@/lib/workspace/connection";
import { completeWorkspaceSetup } from "@/lib/workspace/setup";
import { provisionOperationalWorkbook } from "@/lib/workspace/workbook";

export async function createOperationalWorkbookAction(): Promise<void> {
  const session = await requireAdmin();
  const pending = await getPendingWorkspaceConnection();
  if (!pending || pending.accountGoogleSub !== session.sub) throw new Error("Google Workspace account does not match the installation owner.");
  await provisionOperationalWorkbook();
  revalidatePath("/admin/setup");
}

export async function createSlipFolderAction(): Promise<void> {
  const session = await requireAdmin();
  const pending = await getPendingWorkspaceConnection();
  if (!pending || pending.accountGoogleSub !== session.sub) throw new Error("Google Workspace account does not match the installation owner.");
  const drive = createOAuthDriveClient(pending);
  if (pending.folderId) {
    await validateDriveFolder(pending.folderId, { drive, permissionMessage: "Connected Google account needs Editor access to this folder." });
    await testDriveFolderWrite(pending.folderId, drive);
    if (pending.spreadsheetId) await setInstallationStatus(session.sub, "WORKSPACE_CONNECTED");
    revalidatePath("/admin/setup");
    return;
  }
  const folder = await createDriveFolder("Coaching Payment Slips", drive);
  await validateDriveFolder(folder.folderId, { drive, permissionMessage: "Connected Google account needs Editor access to this folder." });
  await testDriveFolderWrite(folder.folderId, drive);
  await savePendingWorkspaceConnection({ ...pending, ...folder });
  if (pending.spreadsheetId) await setInstallationStatus(session.sub, "WORKSPACE_CONNECTED");
  revalidatePath("/admin/setup");
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

export async function completeSetupAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const config = parseRuntimeConfig({
    businessDisplayName: String(formData.get("business_display_name") ?? ""),
    promptPayType: String(formData.get("promptpay_type") ?? ""),
    promptPayIdentifier: String(formData.get("promptpay_identifier") ?? ""),
    recipientNameEn: String(formData.get("recipient_name_en") ?? ""),
    recipientNameTh: String(formData.get("recipient_name_th") ?? ""),
    recipientAliases: String(formData.get("recipient_aliases") ?? "").split(","),
    publicBaseUrl: String(formData.get("public_base_url") ?? ""),
    slipRetentionDays: String(formData.get("slip_retention_days") ?? "30"),
    ocrEnabled: checkbox(formData, "ocr_enabled"),
    lineLiffId: String(formData.get("line_liff_id") ?? ""),
    lineLoginChannelId: String(formData.get("line_login_channel_id") ?? ""),
    lineLinkingEnabled: checkbox(formData, "line_linking_enabled"),
    lineMessagingEnabled: checkbox(formData, "line_messaging_enabled"),
    lineChatPaymentsEnabled: checkbox(formData, "line_chat_payments_enabled"),
  });
  await completeWorkspaceSetup({ ownerGoogleSub: session.sub, config });
  redirect("/admin/dashboard");
}
