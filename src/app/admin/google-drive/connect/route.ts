import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  createGoogleDriveOAuthClient,
  createOAuthState,
  createPkceChallenge,
  createPkceVerifier,
  googleDriveConfig,
  googleDriveRedirectUri,
  googleDriveScopes,
} from "@/lib/storage/google-drive-auth";

const FLOW_MAX_AGE = 600;

function settingsRedirect(request: NextRequest, error: string): NextResponse {
  const url = new URL("/admin/settings", request.url);
  url.searchParams.set("drive_error", error);
  return NextResponse.redirect(url);
}

function flowCookieOptions(path: string): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path, maxAge: FLOW_MAX_AGE };
}

export async function GET(request: NextRequest): Promise<Response> {
  await requireAdmin();
  const config = googleDriveConfig();
  if (!config) return settingsRedirect(request, "oauth_not_configured");

  const state = createOAuthState();
  const verifier = createPkceVerifier();
  const redirectUri = googleDriveRedirectUri(request.nextUrl.origin);
  const client = createGoogleDriveOAuthClient({ config, redirectUri });
  const authorizationUrl = client.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: [...googleDriveScopes],
    state,
    code_challenge: createPkceChallenge(verifier),
    code_challenge_method: "S256",
  });

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set("google_drive_oauth_state", state, flowCookieOptions("/admin/google-drive"));
  response.cookies.set("google_drive_oauth_pkce", verifier, flowCookieOptions("/admin/google-drive"));
  return response;
}
