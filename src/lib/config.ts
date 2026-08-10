export const requiredConfiguration = (environment: Record<string, string | undefined> = process.env): string[] => {
  const required = ["SPREADSHEET_ID", "GOOGLE_SERVICE_ACCOUNT_JSON", "PROMPTPAY_IDENTIFIER", "RECIPIENT_NAME_EN", "SLIP_STORAGE_FOLDER_ID"];
  return required.filter((key) => !environment[key] || environment[key] === "CONFIG_REQUIRED");
};

export function configuredReceiverAliases(environment: Record<string, string | undefined> = process.env): string[] {
  return [environment.RECIPIENT_NAME_EN, environment.RECIPIENT_NAME_TH, ...(environment.RECIPIENT_NAME_ALIASES ?? "").split(",")]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && value !== "CONFIG_REQUIRED");
}

export function configuredSlipRetentionDays(environment: Record<string, string | undefined> = process.env): number {
  const value = Number(environment.SLIP_RETENTION_DAYS ?? "30");
  return Number.isSafeInteger(value) && value >= 0 && value <= 365 ? value : 30;
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
    slipStorageFolderId: process.env.SLIP_STORAGE_FOLDER_ID!,
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!
  };
}
