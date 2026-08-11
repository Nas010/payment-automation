import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  createGoogleDriveOAuthClient,
  decodeDriveCandidate,
  googleDriveConfig,
  googleDriveRedirectUri,
} from "@/lib/storage/google-drive-auth";
import { getGoogleDriveConnection } from "@/lib/storage/google-drive-connection";

function safeError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest): Promise<Response> {
  await requireAdmin();
  const config = googleDriveConfig();
  if (!config) return safeError("Google Drive connection is not configured.", 503);

  const cookieStore = await cookies();
  const candidateCookie = cookieStore.get("google_drive_candidate")?.value;
  let candidate = null;
  try {
    candidate = candidateCookie ? decodeDriveCandidate(candidateCookie) : null;
  } catch {
    return safeError("Google Drive connection needs attention.", 409);
  }
  const activeConnection = candidate ? null : await getGoogleDriveConnection();
  const connection = candidate ?? activeConnection;
  if (!connection) return safeError("Google Drive connection is not connected.", 409);

  try {
    const client = createGoogleDriveOAuthClient({ config, redirectUri: googleDriveRedirectUri(request.nextUrl.origin) });
    client.setCredentials({ refresh_token: connection.refreshToken });
    const accessResponse = await client.getAccessToken();
    const accessToken = typeof accessResponse === "string" ? accessResponse : accessResponse.token;
    if (!accessToken) return safeError("Google Drive connection needs attention.", 409);
    const folderFields = candidate || !activeConnection ? {} : { folderId: activeConnection.folderId, folderName: activeConnection.folderName };
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
