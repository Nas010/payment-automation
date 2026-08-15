const INFRASTRUCTURE_KEYS = [
  "SPREADSHEET_ID",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "ADMIN_SECRET",
  "CRON_SECRET",
  "SETTINGS_ENCRYPTION_KEY",
  "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
  "GOOGLE_DRIVE_PICKER_API_KEY",
  "GOOGLE_DRIVE_PROJECT_NUMBER",
] as const;

export const requiredConfiguration = (environment: Record<string, string | undefined> = process.env): string[] => INFRASTRUCTURE_KEYS
  .filter((key) => !environment[key]?.trim() || environment[key] === "CONFIG_REQUIRED");

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

export function googleDriveRedirectUri(origin: string): string {
  return new URL("/admin/google-drive/callback", new URL(origin)).toString();
}

/** Configuration needed only by the private bootstrap/key-safe workbook. */
export function sheetsConfig(environment: Record<string, string | undefined> = process.env) {
  const missing = ["SPREADSHEET_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"].filter((key) => !environment[key] || environment[key] === "CONFIG_REQUIRED");
  if (missing.length) throw new Error(`Configuration required: ${missing.join(", ")}`);
  return { spreadsheetId: environment.SPREADSHEET_ID!, serviceAccountJson: environment.GOOGLE_SERVICE_ACCOUNT_JSON! };
}

export function cronSecret(environment: Record<string, string | undefined> = process.env): string {
  const value = configuredOptionalValue(environment.CRON_SECRET);
  if (!value) throw new Error("CRON_SECRET must be configured.");
  return value;
}
