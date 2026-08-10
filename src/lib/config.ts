export const requiredConfiguration = (environment: Record<string, string | undefined> = process.env): string[] => {
  const required = ["SPREADSHEET_ID", "GOOGLE_SERVICE_ACCOUNT_JSON", "PROMPTPAY_IDENTIFIER", "RECIPIENT_NAME_EN"];
  return required.filter((key) => !environment[key] || environment[key] === "CONFIG_REQUIRED");
};

export function serverConfig() {
  const missing = requiredConfiguration();
  if (missing.length) throw new Error(`Configuration required: ${missing.join(", ")}`);
  return {
    spreadsheetId: process.env.SPREADSHEET_ID!,
    promptPayIdentifier: process.env.PROMPTPAY_IDENTIFIER!,
    promptPayType: (process.env.PROMPTPAY_TYPE ?? "phone") as "phone" | "national_id" | "ewallet",
    recipientNameEn: process.env.RECIPIENT_NAME_EN!,
    recipientNameTh: process.env.RECIPIENT_NAME_TH ?? "",
    businessDisplayName: process.env.BUSINESS_DISPLAY_NAME ?? "Coaching Payments",
    baseUrl: process.env.PRODUCTION_BASE_URL ?? "",
    adminSecret: process.env.ADMIN_SECRET ?? "",
    cronSecret: process.env.CRON_SECRET ?? "",
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!
  };
}
