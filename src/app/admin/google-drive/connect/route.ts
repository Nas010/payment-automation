import { NextRequest, NextResponse } from "next/server";
import { CodeChallengeMethod } from "google-auth-library";
import { requireAdmin } from "@/lib/admin-auth";
import {
  createGoogleDriveOAuthClient,
  createOAuthNonce,
  createOAuthState,
  createPkceChallenge,
  createPkceVerifier,
  googleDriveConfig,
  googleDriveRedirectUri,
  googleDriveScopes,
} from "@/lib/storage/google-drive-auth";

const FLOW_MAX_AGE = 600;

function oauthErrorRedirect(request: NextRequest, intent: "login" | "setup" | "reconnect", error: string): NextResponse {
  const url = new URL(intent === "login" ? "/admin/login" : intent === "setup" ? "/admin/setup" : "/admin/settings", request.url);
  url.searchParams.set(intent === "login" ? "error" : "drive_error", error);
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestedIntent = request.nextUrl.searchParams.get("intent") ?? "reconnect";
  const intent = requestedIntent === "login" || requestedIntent === "setup" || requestedIntent === "reconnect" ? requestedIntent : "reconnect";
  if (intent === "reconnect") await requireAdmin();
  const config = googleDriveConfig();
  if (!config) return oauthErrorRedirect(request, intent, "oauth_not_configured");

  const state = createOAuthState();
  const nonce = createOAuthNonce();
  const verifier = createPkceVerifier();
  const redirectUri = googleDriveRedirectUri(request.nextUrl.origin);
  const client = createGoogleDriveOAuthClient({ config, redirectUri });
  const authorizationUrl = client.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent select_account",
    scope: [...googleDriveScopes],
    state,
    nonce,
    code_challenge: createPkceChallenge(verifier),
    code_challenge_method: CodeChallengeMethod.S256,
  });

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set("google_drive_oauth_state", state, flowCookieOptions("/admin/google-drive"));
  response.cookies.set("google_drive_oauth_pkce", verifier, flowCookieOptions("/admin/google-drive"));
  response.cookies.set("google_drive_oauth_nonce", nonce, flowCookieOptions("/admin/google-drive"));
  response.cookies.set("google_drive_oauth_intent", intent, flowCookieOptions("/admin/google-drive"));
  return response;
}
