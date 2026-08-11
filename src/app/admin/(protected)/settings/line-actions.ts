"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { DEFAULT_LINE_DUE_TEMPLATE, renderLineDueTemplate, validateLineDueTemplate } from "@/lib/line/message-template";
import { getLineChannelAccessToken, setSecret } from "@/lib/secrets/service";
import { upsertOperationalSetting } from "@/lib/sheets/settings";
import { appendAudit } from "@/lib/sheets/payments";
import type { LineDueTemplateActionResult } from "@/components/admin/line-due-template-form";
import type { LineCredentialActionResult } from "@/components/admin/line-integration-form";

const validationSettingKey = "line_access_token_validation";
const dueTemplateSettingKey = "line_due_message_template";
const dueTemplatePreviewValues = {
  client_name: "Nisa",
  payment_label: "August coaching",
  amount: "฿1,500.00",
  due_date: "2026-08-15",
  payment_url: "https://payments.example/p/sample-token",
};

function submittedValue(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function templateResult(template: string): LineDueTemplateActionResult {
  return { ok: true, template, preview: renderLineDueTemplate(template, dueTemplatePreviewValues) };
}

async function auditTemplateChange(action: "LINE_DUE_TEMPLATE_SAVED" | "LINE_DUE_TEMPLATE_RESET"): Promise<void> {
  await appendAudit({
    paymentId: "",
    clientId: "",
    action,
    previousStatus: dueTemplateSettingKey,
    newStatus: dueTemplateSettingKey,
    reason: "LINE due-payment template updated",
    source: "ADMIN",
    metadata: JSON.stringify({ settingKey: dueTemplateSettingKey }),
  });
}

export async function previewLineDueTemplateAction(formData: FormData): Promise<LineDueTemplateActionResult> {
  await requireAdmin();
  return templateResult(submittedValue(formData, "template"));
}

export async function saveLineDueTemplateAction(formData: FormData): Promise<LineDueTemplateActionResult> {
  await requireAdmin();
  const template = submittedValue(formData, "template");
  validateLineDueTemplate(template);
  await upsertOperationalSetting(dueTemplateSettingKey, template);
  await auditTemplateChange("LINE_DUE_TEMPLATE_SAVED");
  revalidatePath("/admin/settings");
  return templateResult(template);
}

export async function resetLineDueTemplateAction(): Promise<LineDueTemplateActionResult> {
  await requireAdmin();
  await upsertOperationalSetting(dueTemplateSettingKey, DEFAULT_LINE_DUE_TEMPLATE);
  await auditTemplateChange("LINE_DUE_TEMPLATE_RESET");
  revalidatePath("/admin/settings");
  return templateResult(DEFAULT_LINE_DUE_TEMPLATE);
}

export async function saveAndTestLineCredentialsAction(formData: FormData): Promise<LineCredentialActionResult> {
  await requireAdmin();
  const accessToken = submittedValue(formData, "channel_access_token");
  const channelSecret = submittedValue(formData, "channel_secret");
  const validatedAt = new Date().toISOString();
  let status: LineCredentialActionResult["status"] = "FAILED";

  try {
    if (accessToken) await setSecret({ keyName: "line_channel_access_token", plaintext: accessToken });
    if (channelSecret) await setSecret({ keyName: "line_channel_secret", plaintext: channelSecret });
    const resolvedAccessToken = await getLineChannelAccessToken();
    const response = await fetch("https://api.line.me/v2/bot/info", { headers: { Authorization: `Bearer ${resolvedAccessToken}` } });
    status = response.ok ? "VALID" : "FAILED";
  } catch {
    status = "FAILED";
  }

  await upsertOperationalSetting(validationSettingKey, JSON.stringify({ status, validatedAt }));
  revalidatePath("/admin/settings");
  return { ok: status === "VALID", status, validatedAt };
}
