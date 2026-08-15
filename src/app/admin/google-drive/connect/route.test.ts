import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  googleDriveConfig: vi.fn(),
  googleDriveRedirectUri: vi.fn(),
  createOAuthState: vi.fn(),
  createOAuthNonce: vi.fn(),
  createPkceVerifier: vi.fn(),
  createPkceChallenge: vi.fn(),
  createGoogleDriveOAuthClient: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/storage/google-drive-auth", () => ({
  googleDriveScopes: ["https://www.googleapis.com/auth/drive.file", "openid", "email"],
  googleDriveConfig: mocks.googleDriveConfig,
  googleDriveRedirectUri: mocks.googleDriveRedirectUri,
  createOAuthState: mocks.createOAuthState,
  createOAuthNonce: mocks.createOAuthNonce,
  createPkceVerifier: mocks.createPkceVerifier,
  createPkceChallenge: mocks.createPkceChallenge,
  createGoogleDriveOAuthClient: mocks.createGoogleDriveOAuthClient,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.googleDriveConfig.mockReturnValue({ clientId: "client-id", clientSecret: "client-secret", pickerApiKey: "picker-key", projectNumber: "123456789" });
  mocks.googleDriveRedirectUri.mockReturnValue("https://app.example/admin/google-drive/callback");
  mocks.createOAuthState.mockReturnValue("state-value");
  mocks.createOAuthNonce.mockReturnValue("nonce-value");
  mocks.createPkceVerifier.mockReturnValue("pkce-verifier");
  mocks.createPkceChallenge.mockReturnValue("pkce-challenge");
  mocks.createGoogleDriveOAuthClient.mockReturnValue({ generateAuthUrl: vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?client_id=client-id&scope=drive.file") });
});

describe("Google Drive OAuth connect route", () => {
  it("requires admin before starting a reconnect OAuth flow", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("Unauthorized"));

    await expect(GET(new NextRequest("https://app.example/admin/google-drive/connect?intent=reconnect"))).rejects.toThrow("Unauthorized");
    expect(mocks.googleDriveConfig).not.toHaveBeenCalled();
  });

  it("redirects safely when OAuth configuration is absent", async () => {
    mocks.googleDriveConfig.mockReturnValue(null);

    const response = await GET(new NextRequest("https://app.example/admin/google-drive/connect?intent=login"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/login?error=oauth_not_configured");
  });

  it("returns reconnect configuration errors to Workspace settings", async () => {
    mocks.googleDriveConfig.mockReturnValue(null);

    const response = await GET(new NextRequest("https://app.example/admin/google-drive/connect?intent=reconnect"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/settings/workspace?drive_error=oauth_not_configured");
  });

  it("sets short-lived state and PKCE cookies and redirects to Google", async () => {
    const response = await GET(new NextRequest("https://app.example/admin/google-drive/connect?intent=login"));

    expect(response.headers.get("location")).toContain("accounts.google.com");
    expect(mocks.createGoogleDriveOAuthClient).toHaveBeenCalledWith(expect.objectContaining({ redirectUri: "https://app.example/admin/google-drive/callback" }));
    const authUrlOptions = mocks.createGoogleDriveOAuthClient.mock.results[0].value.generateAuthUrl.mock.calls[0][0];
    expect(authUrlOptions).toMatchObject({
      access_type: "offline",
      include_granted_scopes: true,
      prompt: "consent select_account",
      state: "state-value",
      code_challenge: "pkce-challenge",
      code_challenge_method: "S256",
      nonce: "nonce-value",
      scope: ["https://www.googleapis.com/auth/drive.file", "openid", "email"],
    });
    expect(response.cookies.get("google_drive_oauth_state")?.value).toBe("state-value");
    expect(response.cookies.get("google_drive_oauth_pkce")?.value).toBe("pkce-verifier");
    expect(response.cookies.get("google_drive_oauth_nonce")?.value).toBe("nonce-value");
    expect(response.cookies.get("google_drive_oauth_intent")?.value).toBe("login");
    expect(response.cookies.get("google_drive_oauth_state")).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/admin/google-drive", maxAge: 600 });
    expect(response.headers.get("location")).not.toContain("client-secret");
  });
});
