import { buildPromptPayPayload, type PromptPayType } from "@/lib/promptpay/generate";
import { listOperationalSettings } from "@/lib/sheets/settings";

export type RuntimeConfig = {
  businessDisplayName: string;
  promptPayType: PromptPayType;
  promptPayIdentifier: string;
  recipientNameEn: string;
  recipientNameTh: string;
  recipientAliases: string[];
  publicBaseUrl: string;
  slipRetentionDays: number;
  ocrEnabled: boolean;
  lineLiffId: string;
  lineLoginChannelId: string;
  lineLinkingEnabled: boolean;
  lineMessagingEnabled: boolean;
  lineChatPaymentsEnabled: boolean;
};

type RuntimeConfigInput = Partial<Record<keyof RuntimeConfig, unknown>>;

function requiredString(value: unknown, message: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(message);
  return normalized;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalEnvironmentValue(value: string | undefined): string {
  const normalized = optionalString(value);
  return normalized === "CONFIG_REQUIRED" ? "" : normalized;
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value === "boolean") return value;
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be enabled or disabled.`);
}

export function parseRuntimeConfig(input: RuntimeConfigInput): RuntimeConfig {
  const businessDisplayName = requiredString(input.businessDisplayName, "Business display name is required.");
  const promptPayType = input.promptPayType;
  if (promptPayType !== "phone" && promptPayType !== "national_id" && promptPayType !== "ewallet") throw new Error("PromptPay type is invalid.");
  const promptPayIdentifier = requiredString(input.promptPayIdentifier, "PromptPay identifier is required.");
  buildPromptPayPayload(promptPayIdentifier, promptPayType, 100);
  const recipientNameEn = requiredString(input.recipientNameEn, "Recipient English name is required.");
  const recipientNameTh = typeof input.recipientNameTh === "string" ? input.recipientNameTh.trim() : "";
  const recipientAliases = Array.isArray(input.recipientAliases)
    ? [...new Set(input.recipientAliases.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))]
    : [];
  const rawUrl = requiredString(input.publicBaseUrl, "Public base URL is required.");
  let publicBaseUrl: string;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid protocol");
    publicBaseUrl = url.origin;
  } catch {
    throw new Error("Public base URL must use HTTP or HTTPS.");
  }
  const slipRetentionDays = Number(input.slipRetentionDays);
  if (!Number.isSafeInteger(slipRetentionDays) || slipRetentionDays < 0 || slipRetentionDays > 365) throw new Error("Slip retention must be between 0 and 365 days.");
  const ocrEnabled = booleanValue(input.ocrEnabled, "OCR");
  const lineLiffId = optionalString(input.lineLiffId);
  const lineLoginChannelId = optionalString(input.lineLoginChannelId);
  if (lineLiffId && !/^\d{5,}-[A-Za-z0-9]+$/.test(lineLiffId)) throw new Error("LINE LIFF ID is malformed.");
  if (lineLoginChannelId && !/^\d{5,}$/.test(lineLoginChannelId)) throw new Error("LINE Login channel ID is malformed.");
  const lineLinkingEnabled = booleanValue(input.lineLinkingEnabled, "LINE linking");
  const lineMessagingEnabled = booleanValue(input.lineMessagingEnabled, "LINE messaging");
  const lineChatPaymentsEnabled = booleanValue(input.lineChatPaymentsEnabled, "LINE chat payments");
  if (lineLinkingEnabled && (!lineLiffId || !lineLoginChannelId)) throw new Error("LINE LIFF ID and LINE Login channel ID are required when LINE linking is enabled.");
  if ((lineMessagingEnabled || lineChatPaymentsEnabled) && !lineLinkingEnabled) throw new Error("LINE messaging requires LINE linking.");
  return { businessDisplayName, promptPayType, promptPayIdentifier, recipientNameEn, recipientNameTh, recipientAliases, publicBaseUrl, slipRetentionDays, ocrEnabled, lineLiffId, lineLoginChannelId, lineLinkingEnabled, lineMessagingEnabled, lineChatPaymentsEnabled };
}

const KEY_MAP: Record<keyof RuntimeConfig, string> = {
  businessDisplayName: "business_display_name",
  promptPayType: "promptpay_type",
  promptPayIdentifier: "promptpay_identifier",
  recipientNameEn: "recipient_name_en",
  recipientNameTh: "recipient_name_th",
  recipientAliases: "recipient_aliases",
  publicBaseUrl: "public_base_url",
  slipRetentionDays: "slip_retention_days",
  ocrEnabled: "ocr_enabled",
  lineLiffId: "line_liff_id",
  lineLoginChannelId: "line_login_channel_id",
  lineLinkingEnabled: "line_linking_enabled",
  lineMessagingEnabled: "line_messaging_enabled",
  lineChatPaymentsEnabled: "line_chat_payments_enabled",
};

export function runtimeConfigEntries(config: RuntimeConfig): Array<{ key: string; value: string }> {
  return (Object.keys(KEY_MAP) as Array<keyof RuntimeConfig>).map((key) => ({
    key: KEY_MAP[key],
    value: key === "recipientAliases" ? JSON.stringify(config[key]) : String(config[key]),
  }));
}

export function defaultRuntimeConfig(requestOrigin: string): RuntimeConfigInput {
  return {
    businessDisplayName: "Coaching Payments",
    promptPayType: "phone",
    promptPayIdentifier: "",
    recipientNameEn: "",
    recipientNameTh: "",
    recipientAliases: [],
    publicBaseUrl: requestOrigin,
    slipRetentionDays: 30,
    ocrEnabled: true,
    lineLiffId: "",
    lineLoginChannelId: "",
    lineLinkingEnabled: false,
    lineMessagingEnabled: false,
    lineChatPaymentsEnabled: false,
  };
}

export async function runtimeConfig(environment: Record<string, string | undefined> = process.env): Promise<RuntimeConfig> {
  const settings = await listOperationalSettings();
  const values = new Map(settings.map((entry) => [entry.key, entry.value]));
  let recipientAliases: unknown = [];
  try {
    recipientAliases = JSON.parse(values.get(KEY_MAP.recipientAliases) ?? "[]");
  } catch {
    throw new Error("Runtime configuration is invalid.");
  }
  const workbookLineLiffId = optionalString(values.get(KEY_MAP.lineLiffId));
  const workbookLineLoginChannelId = optionalString(values.get(KEY_MAP.lineLoginChannelId));
  const lineLiffId = workbookLineLiffId || optionalEnvironmentValue(environment.LINE_LIFF_ID);
  const lineLoginChannelId = workbookLineLoginChannelId || optionalEnvironmentValue(environment.LINE_LOGIN_CHANNEL_ID);
  const hasLineAppIdentifiers = Boolean(lineLiffId && lineLoginChannelId);
  return parseRuntimeConfig({
    businessDisplayName: values.get(KEY_MAP.businessDisplayName),
    promptPayType: values.get(KEY_MAP.promptPayType),
    promptPayIdentifier: values.get(KEY_MAP.promptPayIdentifier),
    recipientNameEn: values.get(KEY_MAP.recipientNameEn),
    recipientNameTh: values.get(KEY_MAP.recipientNameTh) ?? "",
    recipientAliases,
    publicBaseUrl: values.get(KEY_MAP.publicBaseUrl),
    slipRetentionDays: values.get(KEY_MAP.slipRetentionDays),
    ocrEnabled: values.get(KEY_MAP.ocrEnabled),
    lineLiffId,
    lineLoginChannelId,
    lineLinkingEnabled: hasLineAppIdentifiers ? values.get(KEY_MAP.lineLinkingEnabled) : false,
    lineMessagingEnabled: hasLineAppIdentifiers ? values.get(KEY_MAP.lineMessagingEnabled) : false,
    lineChatPaymentsEnabled: hasLineAppIdentifiers ? values.get(KEY_MAP.lineChatPaymentsEnabled) : false,
  });
}
