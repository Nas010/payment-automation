export const requiredConfiguration = (environment: Record<string, string | undefined> = process.env): string[] => {
  const required = ["SPREADSHEET_ID", "GOOGLE_SERVICE_ACCOUNT_JSON", "PROMPTPAY_IDENTIFIER", "RECIPIENT_NAME_EN"];
  return required.filter((key) => !environment[key] || environment[key] === "CONFIG_REQUIRED");
};

export type GoogleDriveConfig = {
  clientId: string;
  clientSecret: string;
  pickerApiKey: string;
  projectNumber: string;
};

function configuredOptionalValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "CONFIG_REQUIRED" ? trimmed : null;
}

export function googleDriveConfig(environment: Record<string, string | undefined> = process.env): GoogleDriveConfig | null {
  const clientId = configuredOptionalValue(environment.GOOGLE_DRIVE_OAUTH_CLIENT_ID);
  const clientSecret = configuredOptionalValue(environment.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET);
  const pickerApiKey = configuredOptionalValue(environment.GOOGLE_DRIVE_PICKER_API_KEY);
  const projectNumber = configuredOptionalValue(environment.GOOGLE_DRIVE_PROJECT_NUMBER);
  if (!clientId || !clientSecret || !pickerApiKey || !projectNumber) return null;
  return { clientId, clientSecret, pickerApiKey, projectNumber };
}

export function googleDriveRedirectUri(origin: string, environment: Record<string, string | undefined> = process.env): string {
  const configuredBaseUrl = configuredOptionalValue(environment.PRODUCTION_BASE_URL);
  const baseUrl = configuredBaseUrl ?? origin;
  const url = new URL(baseUrl);
  return new URL("/admin/google-drive/callback", url).toString();
}

export function configuredReceiverAliases(environment: Record<string, string | undefined> = process.env): string[] {
  return [environment.RECIPIENT_NAME_EN, environment.RECIPIENT_NAME_TH, ...(environment.RECIPIENT_NAME_ALIASES ?? "").split(",")]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && value !== "CONFIG_REQUIRED");
}

export function configuredSlipRetentionDays(environment: Record<string, string | undefined> = process.env): number {
  const value = Number(environment.SLIP_RETENTION_DAYS ?? "30");
  return Number.isSafeInteger(value) && value >= 0 && value <= 365 ? value : 30;
}

/** LINE linking is off unless explicitly enabled in the server environment. */
export function lineLinkingEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.LINE_LINKING_ENABLED?.trim().toLowerCase() === "true";
}

/** LINE push delivery is off unless explicitly enabled in the server environment. */
export function lineMessagingEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.LINE_MESSAGING_ENABLED?.trim().toLowerCase() === "true";
}

/** LINE chat payment intake is off unless explicitly enabled in the server environment. */
export function lineChatPaymentsEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.LINE_CHAT_PAYMENTS_ENABLED?.trim().toLowerCase() === "true";
}

/** Optional server-only LINE settings. Encrypted workbook records take precedence when present. */
export function lineConfig(environment: Record<string, string | undefined> = process.env) {
  return {
    settingsEncryptionKey: environment.SETTINGS_ENCRYPTION_KEY ?? "",
    channelAccessToken: environment.LINE_CHANNEL_ACCESS_TOKEN ?? "",
    channelSecret: environment.LINE_CHANNEL_SECRET ?? "",
  };
}

export function paymentLinkBaseUrl(environment: Record<string, string | undefined> = process.env, requestOrigin: string | null): string {
  const configuredUrl = environment.PRODUCTION_BASE_URL?.trim();
  if (configuredUrl && configuredUrl !== "CONFIG_REQUIRED") return configuredUrl;
  if (requestOrigin) {
    try {
      const url = new URL(requestOrigin);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {}
  }
  throw new Error("PRODUCTION_BASE_URL is required before payment links can be generated");
}

/** Configuration needed by the private Google Sheets repository only. */
export function sheetsConfig(environment: Record<string, string | undefined> = process.env) {
  const missing = ["SPREADSHEET_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"].filter((key) => !environment[key] || environment[key] === "CONFIG_REQUIRED");
  if (missing.length) throw new Error(`Configuration required: ${missing.join(", ")}`);
  return { spreadsheetId: environment.SPREADSHEET_ID!, serviceAccountJson: environment.GOOGLE_SERVICE_ACCOUNT_JSON! };
}

export function serverConfig() {
  const missing = requiredConfiguration();
  if (missing.length) throw new Error(`Configuration required: ${missing.join(", ")}`);
  return {
    spreadsheetId: process.env.SPREADSHEET_ID!,
    promptPayIdentifier: process.env.PROMPTPAY_IDENTIFIER!,
    promptPayType: (process.env.PROMPTPAY_TYPE ?? "phone") as "phone" | "national_id" | "ewallet",
    recipientNameEn: process.env.RECIPIENT_NAME_EN!,
    recipientNameTh: process.env.RECIPIENT_NAME_TH ?? "",
    receiverAliases: configuredReceiverAliases(),
    businessDisplayName: process.env.BUSINESS_DISPLAY_NAME ?? "Coaching Payments",
    baseUrl: process.env.PRODUCTION_BASE_URL ?? "",
    adminSecret: process.env.ADMIN_SECRET ?? "",
    cronSecret: process.env.CRON_SECRET ?? "",
    slipRetentionDays: configuredSlipRetentionDays(),
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!
  };
}
