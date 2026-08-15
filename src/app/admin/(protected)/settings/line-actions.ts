"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import {
  DEFAULT_LINE_WELCOME_TEMPLATE,
  renderLineWelcomeTemplate,
  validateLineWelcomeTemplate,
} from "@/lib/line/message-template";
import {
  DEFAULT_LINE_DUE_PROFILES,
  DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG,
  LINE_DUE_PROFILE_SETTING_KEYS,
  LineDueTemplateError,
  REMINDER_SLOTS,
  parseLineDueMessageProfile,
  parseLineInstallmentReminderConfig,
  renderLineDueMessageProfile,
  type LineDueMessageProfile,
  type LineDueMessageProfileActionResult,
  type LineDueSystemValues,
  type LinePaymentType,
  type ReminderSlot,
} from "@/lib/line/message-profile";
import { getLineChannelAccessToken, setSecret } from "@/lib/secrets/service";
import { saveLineDueMessageProfile, saveLineInstallmentReminderConfig, upsertOperationalSetting } from "@/lib/sheets/settings";
import { appendAudit } from "@/lib/sheets/payments";
import type { LineCredentialActionResult } from "@/components/admin/line-integration-form";
import type { LineTemplateActionResult } from "@/components/admin/line-message-template-form";

const validationSettingKey = "line_access_token_validation";
const welcomeTemplateSettingKey = "line_welcome_message_template";
const welcomeTemplatePreviewValues = {
  client_name: "Nisa",
  business_name: "Coach Bee",
  line_connect_url: "https://liff.line.me/1234567890-AbCdEf?token=sample-token",
};
function submittedValue(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function submittedPaymentType(formData: FormData): LinePaymentType {
  const value = String(formData.get("payment_type") ?? "");
  if (value !== "ONE_TIME" && value !== "INSTALLMENTS") {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "Payment type is required");
  }
  return value;
}

function submittedProfile(formData: FormData, paymentType: LinePaymentType): LineDueMessageProfile {
  return parseLineDueMessageProfile(String(formData.get("profile") ?? ""), paymentType);
}

function previewValues(paymentType: LinePaymentType): LineDueSystemValues {
  const common: LineDueSystemValues = {
    client_name: "Nisa",
    package_name: "Personal Training",
    payment_type: paymentType === "ONE_TIME" ? "One-time payment" : "Installments",
    amount: "฿1,500.00",
    total_amount: paymentType === "ONE_TIME" ? "฿1,500.00" : "฿4,500.00",
    due_date: "2026-08-15",
    due_month_name: "August",
    payment_url: "https://payments.example/p/sample-token",
  };
  return paymentType === "INSTALLMENTS" ? {
    ...common,
    installment_number: "2",
    installment_ordinal: "2nd",
    installment_number_word: "two",
    installment_ordinal_word: "second",
    installment_count: "3",
    installment_count_word: "three",
  } : common;
}

function profileResult(paymentType: LinePaymentType, profile: LineDueMessageProfile): LineDueMessageProfileActionResult {
  return {
    ok: true,
    paymentType,
    profile,
    preview: renderLineDueMessageProfile(profile, paymentType, previewValues(paymentType)),
  };
}

async function auditProfileChange(action: "LINE_DUE_PROFILE_SAVED" | "LINE_DUE_PROFILE_RESET", paymentType: LinePaymentType): Promise<void> {
  const settingKey = LINE_DUE_PROFILE_SETTING_KEYS[paymentType];
  await appendAudit({
    paymentId: "",
    clientId: "",
    action,
    previousStatus: settingKey,
    newStatus: settingKey,
    reason: "LINE due-payment profile updated",
    source: "ADMIN",
    metadata: JSON.stringify({ settingKey, paymentType }),
  });
}

async function auditWelcomeTemplateChange(action: "LINE_WELCOME_TEMPLATE_SAVED" | "LINE_WELCOME_TEMPLATE_RESET"): Promise<void> {
  await appendAudit({
    paymentId: "",
    clientId: "",
    action,
    previousStatus: welcomeTemplateSettingKey,
    newStatus: welcomeTemplateSettingKey,
    reason: "LINE welcome template updated",
    source: "ADMIN",
    metadata: JSON.stringify({ settingKey: welcomeTemplateSettingKey }),
  });
}

export async function previewLineDueMessageProfileAction(formData: FormData): Promise<LineDueMessageProfileActionResult> {
  await requireAdmin();
  const paymentType = submittedPaymentType(formData);
  const profile = submittedProfile(formData, paymentType);
  return profileResult(paymentType, profile);
}

export async function saveLineDueMessageProfileAction(formData: FormData): Promise<LineDueMessageProfileActionResult> {
  await requireAdmin();
  const paymentType = submittedPaymentType(formData);
  const profile = submittedProfile(formData, paymentType);
  await saveLineDueMessageProfile(paymentType, profile);
  await auditProfileChange("LINE_DUE_PROFILE_SAVED", paymentType);
  revalidatePath("/admin/settings");
  return profileResult(paymentType, profile);
}

export async function resetLineDueMessageProfileAction(formData: FormData): Promise<LineDueMessageProfileActionResult> {
  await requireAdmin();
  const paymentType = submittedPaymentType(formData);
  const profile = DEFAULT_LINE_DUE_PROFILES[paymentType];
  await saveLineDueMessageProfile(paymentType, profile);
  await auditProfileChange("LINE_DUE_PROFILE_RESET", paymentType);
  revalidatePath("/admin/settings");
  return profileResult(paymentType, profile);
}

export type ReminderConfigActionResult = { ok: true; slot: ReminderSlot; config: import("@/lib/line/message-profile").LineInstallmentReminderConfig; preview: string };

function submittedReminderConfig(formData: FormData) {
  const slot = submittedReminderSlot(formData);
  const config = parseLineInstallmentReminderConfig(String(formData.get("config") ?? ""));
  return { slot, config };
}

function submittedReminderSlot(formData: FormData): ReminderSlot {
  const slot = String(formData.get("slot") ?? "");
  if (!REMINDER_SLOTS.includes(slot as ReminderSlot)) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "Reminder slot is required");
  }
  return slot as ReminderSlot;
}

export async function previewLineInstallmentReminderAction(formData: FormData): Promise<ReminderConfigActionResult> {
  await requireAdmin();
  const slot = submittedReminderSlot(formData);
  const profile = parseLineDueMessageProfile(String(formData.get("profile") ?? ""), "INSTALLMENTS");
  const config = {
    ...DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG,
    profiles: { ...DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles, [slot]: profile },
  };
  return { ok: true, slot, config, preview: renderLineDueMessageProfile(config.profiles[slot], "INSTALLMENTS", previewValues("INSTALLMENTS")) };
}

export async function saveLineInstallmentReminderConfigAction(formData: FormData): Promise<ReminderConfigActionResult> {
  await requireAdmin();
  const { slot, config } = submittedReminderConfig(formData);
  await saveLineInstallmentReminderConfig(config);
  await appendAudit({ paymentId: "", clientId: "", action: "LINE_INSTALLMENT_REMINDER_CONFIG_SAVED", previousStatus: "line_installment_reminder_config", newStatus: "line_installment_reminder_config", reason: "Installment reminder templates updated", source: "ADMIN", metadata: JSON.stringify({ settingKey: "line_installment_reminder_config" }) });
  revalidatePath("/admin/settings");
  return { ok: true, slot, config, preview: renderLineDueMessageProfile(config.profiles[slot], "INSTALLMENTS", previewValues("INSTALLMENTS")) };
}

export async function resetLineInstallmentReminderConfigAction(): Promise<ReminderConfigActionResult> {
  await requireAdmin();
  await saveLineInstallmentReminderConfig(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
  revalidatePath("/admin/settings");
  return { ok: true, slot: "DUE_DATE", config: DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG, preview: renderLineDueMessageProfile(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles.DUE_DATE, "INSTALLMENTS", previewValues("INSTALLMENTS")) };
}

export async function previewLineWelcomeTemplateAction(formData: FormData): Promise<LineTemplateActionResult> {
  await requireAdmin();
  const template = submittedValue(formData, "template");
  return { ok: true, template, preview: renderLineWelcomeTemplate(template, welcomeTemplatePreviewValues) };
}

export async function saveLineWelcomeTemplateAction(formData: FormData): Promise<LineTemplateActionResult> {
  await requireAdmin();
  const template = submittedValue(formData, "template");
  validateLineWelcomeTemplate(template);
  await upsertOperationalSetting(welcomeTemplateSettingKey, template);
  await auditWelcomeTemplateChange("LINE_WELCOME_TEMPLATE_SAVED");
  revalidatePath("/admin/settings");
  return { ok: true, template, preview: renderLineWelcomeTemplate(template, welcomeTemplatePreviewValues) };
}

export async function resetLineWelcomeTemplateAction(): Promise<LineTemplateActionResult> {
  await requireAdmin();
  await upsertOperationalSetting(welcomeTemplateSettingKey, DEFAULT_LINE_WELCOME_TEMPLATE);
  await auditWelcomeTemplateChange("LINE_WELCOME_TEMPLATE_RESET");
  revalidatePath("/admin/settings");
  return { ok: true, template: DEFAULT_LINE_WELCOME_TEMPLATE, preview: renderLineWelcomeTemplate(DEFAULT_LINE_WELCOME_TEMPLATE, welcomeTemplatePreviewValues) };
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
