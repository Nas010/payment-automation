import { google } from "googleapis";
import { sheetsConfig } from "@/lib/config";

/** Service-account client restricted to the developer-owned key-safe workbook. */
export function getBootstrapSheets() {
  const config = sheetsConfig();
  const credentials = JSON.parse(config.serviceAccountJson) as Record<string, string>;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return {
    sheets: google.sheets({ version: "v4", auth }),
    spreadsheetId: config.spreadsheetId,
  };
}
