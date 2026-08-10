import { google } from "googleapis";
import { serverConfig } from "@/lib/config";

export function getGoogleSheets() {
  const config = serverConfig();
  const credentials = JSON.parse(config.serviceAccountJson) as Record<string, string>;
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"] });
  return { sheets: google.sheets({ version: "v4", auth }), spreadsheetId: config.spreadsheetId };
}
