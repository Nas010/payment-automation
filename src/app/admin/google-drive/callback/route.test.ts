import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  googleDriveConfig: vi.fn(),
  googleDriveRedirectUri: vi.fn(),
  createGoogleDriveOAuthClient: vi.fn(),
  verifyGoogleIdentity: vi.fn(),
  isEqualOAuthState: vi.fn(),
  claimInstallationOwner: vi.fn(),
  createAdminSession: vi.fn(),
  savePendingWorkspaceConnection: vi.fn(),
  getActiveWorkspaceConnection: vi.fn(),
  getPendingWorkspaceConnection: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/storage/google-drive-auth", () => ({
  googleDriveConfig: mocks.googleDriveConfig,
  googleDriveRedirectUri: mocks.googleDriveRedirectUri,
  createGoogleDriveOAuthClient: mocks.createGoogleDriveOAuthClient,
  verifyGoogleIdentity: mocks.verifyGoogleIdentity,
  isEqualOAuthState: mocks.isEqualOAuthState,
}));
vi.mock("@/lib/installation/repository", () => ({ claimInstallationOwner: mocks.claimInstallationOwner }));
vi.mock("@/lib/admin-auth", () => ({ createAdminSession: mocks.createAdminSession }));
vi.mock("@/lib/workspace/connection", () => ({
  savePendingWorkspaceConnection: mocks.savePendingWorkspaceConnection,
  getActiveWorkspaceConnection: mocks.getActiveWorkspaceConnection,
  getPendingWorkspaceConnection: mocks.getPendingWorkspaceConnection,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.get.mockImplementation((name: string) => {
    if (name === "google_drive_oauth_state") return { value: "state-value" };
    if (name === "google_drive_oauth_pkce") return { value: "pkce-verifier" };
    if (name === "google_drive_oauth_nonce") return { value: "nonce-value" };
    if (name === "google_drive_oauth_intent") return { value: "login" };
    return undefined;
  });
  mocks.cookies.mockResolvedValue(cookieStore);
  mocks.googleDriveConfig.mockReturnValue({ clientId: "client-id", clientSecret: "client-secret", pickerApiKey: "picker-key", projectNumber: "123456789" });
  mocks.googleDriveRedirectUri.mockReturnValue("https://app.example/admin/google-drive/callback");
  mocks.verifyGoogleIdentity.mockResolvedValue({ googleSub: "google-sub-1", email: "coach@example.com" });
  mocks.claimInstallationOwner.mockResolvedValue({ ownerGoogleSub: "google-sub-1", ownerEmail: "coach@example.com", setupStatus: "CLAIMED" });
  mocks.createAdminSession.mockResolvedValue(undefined);
  mocks.savePendingWorkspaceConnection.mockResolvedValue(undefined);
  mocks.getActiveWorkspaceConnection.mockResolvedValue(null);
  mocks.getPendingWorkspaceConnection.mockResolvedValue(null);
  mocks.isEqualOAuthState.mockImplementation((expected: string | undefined, received: string | undefined) => expected === received);
  const oauthClient = {
    getToken: vi.fn().mockResolvedValue({ tokens: { refresh_token: "refresh-secret", access_token: "access-token", id_token: "id-token" } }),
    setCredentials: vi.fn(),
  };
  mocks.createGoogleDriveOAuthClient.mockReturnValue(oauthClient);
});

describe("Google Drive OAuth callback route", () => {
  it("rejects a mismatched state and clears temporary cookies", async () => {
    const response = await GET(new NextRequest("https://app.example/admin/google-drive/callback?code=code-value&state=wrong"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/login?error=oauth_state_invalid");
    expect(cookieStore.delete).toHaveBeenCalledWith("google_drive_oauth_state");
    expect(cookieStore.delete).toHaveBeenCalledWith("google_drive_oauth_pkce");
    expect(cookieStore.delete).toHaveBeenCalledWith("google_drive_oauth_nonce");
    expect(cookieStore.delete).toHaveBeenCalledWith("google_drive_oauth_intent");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("rejects a provider denial with a fixed error code", async () => {
    const response = await GET(new NextRequest("https://app.example/admin/google-drive/callback?error=access_denied"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/login?error=oauth_denied");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("exchanges code, verifies identity, claims owner, and stages the refresh token", async () => {
    const response = await GET(new NextRequest("https://app.example/admin/google-drive/callback?code=code-value&state=state-value"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/setup");
    expect(cookieStore.delete).toHaveBeenCalledWith("google_drive_oauth_state");
    expect(cookieStore.delete).toHaveBeenCalledWith("google_drive_oauth_pkce");
    expect(mocks.verifyGoogleIdentity).toHaveBeenCalledWith(expect.anything(), { idToken: "id-token", expectedNonce: "nonce-value", clientId: "client-id" });
    expect(mocks.claimInstallationOwner).toHaveBeenCalledWith({ googleSub: "google-sub-1", email: "coach@example.com" });
    expect(mocks.createAdminSession).toHaveBeenCalledWith({ googleSub: "google-sub-1", email: "coach@example.com" });
    expect(mocks.savePendingWorkspaceConnection).toHaveBeenCalledWith({ refreshToken: "refresh-secret", accountGoogleSub: "google-sub-1", accountEmail: "coach@example.com" });
  });

  it("rejects a token exchange without a refresh token", async () => {
    mocks.createGoogleDriveOAuthClient.mockReturnValue({
      getToken: vi.fn().mockResolvedValue({ tokens: { access_token: "access-token" } }),
      setCredentials: vi.fn(),
    });

    const response = await GET(new NextRequest("https://app.example/admin/google-drive/callback?code=code-value&state=state-value"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/login?error=oauth_missing_refresh_token");
    expect(mocks.savePendingWorkspaceConnection).not.toHaveBeenCalled();
  });

  it("handles refresh-token exchange failure without staging credentials", async () => {
    mocks.createGoogleDriveOAuthClient.mockReturnValue({
      getToken: vi.fn().mockRejectedValue(new Error("invalid_grant")),
      setCredentials: vi.fn(),
    });

    const response = await GET(new NextRequest("https://app.example/admin/google-drive/callback?code=code-value&state=state-value"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/login?error=oauth_exchange_failed");
    expect(mocks.savePendingWorkspaceConnection).not.toHaveBeenCalled();
    expect(mocks.createAdminSession).not.toHaveBeenCalled();
  });

  it("routes a completed owner to settings and stages the same immutable workbook", async () => {
    cookieStore.get.mockImplementation((name: string) => {
      if (name === "google_drive_oauth_state") return { value: "state-value" };
      if (name === "google_drive_oauth_pkce") return { value: "pkce-verifier" };
      if (name === "google_drive_oauth_nonce") return { value: "nonce-value" };
      if (name === "google_drive_oauth_intent") return { value: "reconnect" };
      return undefined;
    });
    mocks.claimInstallationOwner.mockResolvedValue({ ownerGoogleSub: "google-sub-1", ownerEmail: "coach@example.com", setupStatus: "COMPLETE" });
    mocks.getActiveWorkspaceConnection.mockResolvedValue({
      refreshToken: "old-refresh-token",
      accountGoogleSub: "google-sub-1",
      accountEmail: "coach@example.com",
      spreadsheetId: "immutable-sheet-123",
      spreadsheetName: "Coaching Payments - Automated",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/immutable-sheet-123/edit",
      folderId: "working-folder-123",
      folderName: "Coaching Payment Slips",
      folderUrl: "https://drive.google.com/drive/folders/working-folder-123",
      validatedAt: "2026-08-15T00:00:00.000Z",
    });

    const response = await GET(new NextRequest("https://app.example/admin/google-drive/callback?code=code-value&state=state-value"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/settings/workspace?workspace=reconnect_pending");
    expect(mocks.savePendingWorkspaceConnection).toHaveBeenCalledWith(expect.objectContaining({
      refreshToken: "refresh-secret",
      spreadsheetId: "immutable-sheet-123",
      folderId: "working-folder-123",
    }));
  });

  it("preserves staged workbook and folder resources when the owner reconnects during setup", async () => {
    mocks.claimInstallationOwner.mockResolvedValue({ ownerGoogleSub: "google-sub-1", ownerEmail: "coach@example.com", setupStatus: "WORKSPACE_CONNECTED" });
    mocks.getPendingWorkspaceConnection.mockResolvedValue({
      refreshToken: "old-refresh-token",
      accountGoogleSub: "google-sub-1",
      accountEmail: "coach@example.com",
      spreadsheetId: "sheet-1234567890",
      spreadsheetName: "Coaching Payments - Automated",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1234567890/edit",
      folderId: "folder-1234567890",
      folderName: "Coaching Payment Slips",
      folderUrl: "https://drive.google.com/drive/folders/folder-1234567890",
    });

    await GET(new NextRequest("https://app.example/admin/google-drive/callback?code=code-value&state=state-value"));

    expect(mocks.savePendingWorkspaceConnection).toHaveBeenCalledWith(expect.objectContaining({
      refreshToken: "refresh-secret",
      spreadsheetId: "sheet-1234567890",
      folderId: "folder-1234567890",
    }));
  });

  it("denies a competing Google account without creating a session", async () => {
    mocks.claimInstallationOwner.mockRejectedValue(new Error("This installation already has an owner."));

    const response = await GET(new NextRequest("https://app.example/admin/google-drive/callback?code=code-value&state=state-value"));

    expect(response.headers.get("location")).toBe("https://app.example/admin/login?error=access_denied");
    expect(mocks.createAdminSession).not.toHaveBeenCalled();
    expect(mocks.savePendingWorkspaceConnection).not.toHaveBeenCalled();
  });
});
