import { google } from "googleapis";
import { googleDriveConfig, googleDriveRedirectUri } from "@/lib/config";
import { getActiveWorkspaceConnection, getPendingWorkspaceConnection } from "@/lib/workspace/connection";

function oauthSheets(refreshToken: string) {
  const config = googleDriveConfig();
  if (!config) throw new Error("Google Workspace OAuth is not configured.");
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret, googleDriveRedirectUri("http://localhost:3000"));
  auth.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: "v4", auth });
}

/** Target-owned operational workbook. Never uses the bootstrap service account. */
export async function getGoogleSheets() {
  const connection = await getActiveWorkspaceConnection();
  if (!connection) throw new Error("Google Workspace is not connected.");
  return { sheets: oauthSheets(connection.refreshToken), spreadsheetId: connection.spreadsheetId };
}

/** Setup-only client for the staged owner authorization. */
export async function getPendingGoogleSheets() {
  const connection = await getPendingWorkspaceConnection();
  if (!connection) throw new Error("Google Workspace authorization is not staged.");
  return { sheets: oauthSheets(connection.refreshToken), connection };
}
