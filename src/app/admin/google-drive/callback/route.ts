import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleDriveOAuthClient,
  encodeDriveCandidate,
  getGoogleAccountEmail,
  googleDriveConfig,
  googleDriveRedirectUri,
  isEqualOAuthState,
} from "@/lib/storage/google-drive-auth";

const FLOW_MAX_AGE = 600;

function settingsRedirect(request: NextRequest, error?: string): NextResponse {
  const url = new URL("/admin/settings", request.url);
  if (error) url.searchParams.set("drive_error", error);
  else url.searchParams.set("drive", "select");
  return NextResponse.redirect(url);
}

function clearFlowCookies(cookieStore: Awaited<ReturnType<typeof cookies>>): void {
  cookieStore.delete("google_drive_oauth_state");
  cookieStore.delete("google_drive_oauth_pkce");
}

function clearAndRedirect(request: NextRequest, cookieStore: Awaited<ReturnType<typeof cookies>>, error: string): NextResponse {
  clearFlowCookies(cookieStore);
  return settingsRedirect(request, error);
}

export async function GET(request: NextRequest): Promise<Response> {
  const cookieStore = await cookies();
  const params = request.nextUrl.searchParams;
  const providerError = params.get("error");
  if (providerError) return clearAndRedirect(request, cookieStore, providerError === "access_denied" ? "oauth_denied" : "oauth_provider_error");

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = cookieStore.get("google_drive_oauth_state")?.value;
  const verifier = cookieStore.get("google_drive_oauth_pkce")?.value;
  if (!code || !state || !verifier) return clearAndRedirect(request, cookieStore, "oauth_callback_invalid");
  if (!isEqualOAuthState(expectedState, state)) return clearAndRedirect(request, cookieStore, "oauth_state_invalid");

  const config = googleDriveConfig();
  if (!config) return clearAndRedirect(request, cookieStore, "oauth_not_configured");
  const redirectUri = googleDriveRedirectUri(request.nextUrl.origin);
  const client = createGoogleDriveOAuthClient({ config, redirectUri });
  clearFlowCookies(cookieStore);

  try {
    const tokenResponse = await client.getToken({ code, codeVerifier: verifier });
    const refreshToken = tokenResponse.tokens.refresh_token;
    if (!refreshToken) return settingsRedirect(request, "oauth_missing_refresh_token");
    client.setCredentials(tokenResponse.tokens);
    const accountEmail = await getGoogleAccountEmail(client);
    const candidate = encodeDriveCandidate({ refreshToken, accountEmail });
    cookieStore.set("google_drive_candidate", candidate, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/admin",
      maxAge: FLOW_MAX_AGE,
    });
    return settingsRedirect(request);
  } catch (error) {
    const message = error instanceof Error && error.message === "Google account email is unavailable." ? "oauth_account_unavailable" : "oauth_exchange_failed";
    return settingsRedirect(request, message);
  }
}
