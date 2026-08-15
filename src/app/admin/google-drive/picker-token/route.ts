import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  createGoogleDriveOAuthClient,
  googleDriveConfig,
  googleDriveRedirectUri,
} from "@/lib/storage/google-drive-auth";
import { getActiveWorkspaceConnection, getPendingWorkspaceConnection } from "@/lib/workspace/connection";

function safeError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest): Promise<Response> {
  await requireAdmin();
  const config = googleDriveConfig();
  if (!config) return safeError("Google Drive connection is not configured.", 503);

  const pendingConnection = await getPendingWorkspaceConnection().catch(() => null);
  const activeConnection = pendingConnection ? null : await getActiveWorkspaceConnection().catch(() => null);
  const connection = pendingConnection ?? activeConnection;
  if (!connection) return safeError("Google Drive connection is not connected.", 409);

  try {
    const client = createGoogleDriveOAuthClient({ config, redirectUri: googleDriveRedirectUri(request.nextUrl.origin) });
    client.setCredentials({ refresh_token: connection.refreshToken });
    const accessResponse = await client.getAccessToken();
    const accessToken = typeof accessResponse === "string" ? accessResponse : accessResponse.token;
    if (!accessToken) return safeError("Google Drive connection needs attention.", 409);
    const folderFields = connection.folderId && connection.folderName ? { folderId: connection.folderId, folderName: connection.folderName } : {};
    return Response.json({
      accessToken,
      appId: config.projectNumber,
      apiKey: config.pickerApiKey,
      ...folderFields,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return safeError("Google Drive connection needs attention.", 409);
  }
}
