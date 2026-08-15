import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSession } from "@/lib/admin-auth";
import { claimInstallationOwner } from "@/lib/installation/repository";
import {
  createGoogleDriveOAuthClient,
  googleDriveConfig,
  googleDriveRedirectUri,
  isEqualOAuthState,
  verifyGoogleIdentity,
} from "@/lib/storage/google-drive-auth";
import { getActiveWorkspaceConnection, getPendingWorkspaceConnection, savePendingWorkspaceConnection } from "@/lib/workspace/connection";

type OAuthIntent = "login" | "setup" | "reconnect";

function parseIntent(value: string | undefined): OAuthIntent {
  return value === "setup" || value === "reconnect" ? value : "login";
}

function flowRedirect(request: NextRequest, intent: OAuthIntent, error?: string, complete = false): NextResponse {
  const url = new URL(intent === "reconnect" || complete ? "/admin/settings/workspace" : error ? "/admin/login" : "/admin/setup", request.url);
  if (error) url.searchParams.set(intent === "reconnect" ? "drive_error" : "error", error);
  else if (intent === "reconnect" || complete) url.searchParams.set("workspace", "reconnect_pending");
  return NextResponse.redirect(url);
}

function clearFlowCookies(cookieStore: Awaited<ReturnType<typeof cookies>>): void {
  cookieStore.delete("google_drive_oauth_state");
  cookieStore.delete("google_drive_oauth_pkce");
  cookieStore.delete("google_drive_oauth_nonce");
  cookieStore.delete("google_drive_oauth_intent");
}

function clearAndRedirect(request: NextRequest, cookieStore: Awaited<ReturnType<typeof cookies>>, intent: OAuthIntent, error: string): NextResponse {
  clearFlowCookies(cookieStore);
  return flowRedirect(request, intent, error);
}

export async function GET(request: NextRequest): Promise<Response> {
  const cookieStore = await cookies();
  const params = request.nextUrl.searchParams;
  const intent = parseIntent(cookieStore.get("google_drive_oauth_intent")?.value);
  const providerError = params.get("error");
  if (providerError) return clearAndRedirect(request, cookieStore, intent, providerError === "access_denied" ? "oauth_denied" : "oauth_provider_error");

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = cookieStore.get("google_drive_oauth_state")?.value;
  const verifier = cookieStore.get("google_drive_oauth_pkce")?.value;
  const nonce = cookieStore.get("google_drive_oauth_nonce")?.value;
  if (!code || !state || !verifier || !nonce) return clearAndRedirect(request, cookieStore, intent, "oauth_callback_invalid");
  if (!isEqualOAuthState(expectedState, state)) return clearAndRedirect(request, cookieStore, intent, "oauth_state_invalid");

  const config = googleDriveConfig();
  if (!config) return clearAndRedirect(request, cookieStore, intent, "oauth_not_configured");
  const redirectUri = googleDriveRedirectUri(request.nextUrl.origin);
  const client = createGoogleDriveOAuthClient({ config, redirectUri });
  clearFlowCookies(cookieStore);

  try {
    const tokenResponse = await client.getToken({ code, codeVerifier: verifier });
    const refreshToken = tokenResponse.tokens.refresh_token;
    const idToken = tokenResponse.tokens.id_token;
    if (!refreshToken) return flowRedirect(request, intent, "oauth_missing_refresh_token");
    if (!idToken) return flowRedirect(request, intent, "oauth_identity_missing");
    client.setCredentials(tokenResponse.tokens);
    const identity = await verifyGoogleIdentity(client, { idToken, expectedNonce: nonce, clientId: config.clientId });
    const installation = await claimInstallationOwner(identity);
    const existing = installation.setupStatus === "COMPLETE"
      ? await getActiveWorkspaceConnection()
      : await getPendingWorkspaceConnection().catch(() => null);
    const reusable = existing?.accountGoogleSub === identity.googleSub ? existing : null;
    await savePendingWorkspaceConnection({
      refreshToken,
      accountGoogleSub: identity.googleSub,
      accountEmail: identity.email,
      ...(reusable ? {
        spreadsheetId: reusable.spreadsheetId,
        spreadsheetName: reusable.spreadsheetName,
        spreadsheetUrl: reusable.spreadsheetUrl,
        folderId: reusable.folderId,
        folderName: reusable.folderName,
        folderUrl: reusable.folderUrl,
      } : {}),
    });
    await createAdminSession(identity);
    return flowRedirect(request, intent, undefined, installation.setupStatus === "COMPLETE");
  } catch (error) {
    const message = error instanceof Error && error.message === "This installation already has an owner." ? "access_denied"
      : error instanceof Error && error.message === "Google identity could not be verified." ? "oauth_identity_invalid"
        : "oauth_exchange_failed";
    return flowRedirect(request, intent, message);
  }
}
