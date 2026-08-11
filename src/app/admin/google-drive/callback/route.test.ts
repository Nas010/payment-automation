import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  googleDriveConfig: vi.fn(),
  googleDriveRedirectUri: vi.fn(),
  createGoogleDriveOAuthClient: vi.fn(),
  getGoogleAccountEmail: vi.fn(),
  isEqualOAuthState: vi.fn(),
  encodeDriveCandidate: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/storage/google-drive-auth", () => ({
  googleDriveConfig: mocks.googleDriveConfig,
  googleDriveRedirectUri: mocks.googleDriveRedirectUri,
  createGoogleDriveOAuthClient: mocks.createGoogleDriveOAuthClient,
  getGoogleAccountEmail: mocks.getGoogleAccountEmail,
  isEqualOAuthState: mocks.isEqualOAuthState,
  encodeDriveCandidate: mocks.encodeDriveCandidate,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.get.mockImplementation((name: string) => name === "google_drive_oauth_state" ? { value: "state-value" } : name === "google_drive_oauth_pkce" ? { value: "pkce-verifier" } : undefined);
  mocks.cookies.mockResolvedValue(cookieStore);
  mocks.googleDriveConfig.mockReturnValue({ clientId: "client-id", clientSecret: "client-secret", pickerApiKey: "picker-key", projectNumber: "123456789" });
  mocks.googleDriveRedirectUri.mockReturnValue("https://app.example/admin/google-drive/callback");
  mocks.encodeDriveCandidate.mockReturnValue("encrypted-candidate");
  mocks.getGoogleAccountEmail.mockResolvedValue("coach@example.com");
  mocks.isEqualOAuthState.mockImplementation((expected: string | undefined, received: string | undefined) => expected === received);
  const oauthClient = {
    getToken: vi.fn().mockResolvedValue({ tokens: { refresh_token: "refresh-secret", access_token: "access-token" } }),
    setCredentials: vi.fn(),
  };
  mocks.createGoogleDriveOAuthClient.mockReturnValue(oauthClient);
});

describe("Google Drive OAuth callback route", () => {
  it("rejects a mismatched state and clears temporary cookies", async () => {
    const response = await GET(new NextRequest("https://app.example/admin/google-drive/callback?code=code-value&state=wrong"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/settings?drive_error=oauth_state_invalid");
    expect(cookieStore.delete).toHaveBeenCalledWith("google_drive_oauth_state");
    expect(cookieStore.delete).toHaveBeenCalledWith("google_drive_oauth_pkce");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("rejects a provider denial with a fixed error code", async () => {
    const response = await GET(new NextRequest("https://app.example/admin/google-drive/callback?error=access_denied"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/settings?drive_error=oauth_denied");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("exchanges code, identifies account, and stores only an encrypted candidate", async () => {
    const response = await GET(new NextRequest("https://app.example/admin/google-drive/callback?code=code-value&state=state-value"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/settings?drive=select");
    expect(cookieStore.delete).toHaveBeenCalledWith("google_drive_oauth_state");
    expect(cookieStore.delete).toHaveBeenCalledWith("google_drive_oauth_pkce");
    expect(cookieStore.set).toHaveBeenCalledWith("google_drive_candidate", "encrypted-candidate", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/admin", maxAge: 600 }));
  });

  it("rejects a token exchange without a refresh token", async () => {
    mocks.createGoogleDriveOAuthClient.mockReturnValue({
      getToken: vi.fn().mockResolvedValue({ tokens: { access_token: "access-token" } }),
      setCredentials: vi.fn(),
    });

    const response = await GET(new NextRequest("https://app.example/admin/google-drive/callback?code=code-value&state=state-value"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/settings?drive_error=oauth_missing_refresh_token");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});
