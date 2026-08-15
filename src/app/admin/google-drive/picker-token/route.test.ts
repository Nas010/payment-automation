import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  googleDriveConfig: vi.fn(),
  googleDriveRedirectUri: vi.fn(),
  getPendingWorkspaceConnection: vi.fn(),
  getActiveWorkspaceConnection: vi.fn(),
  createGoogleDriveOAuthClient: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/storage/google-drive-auth", () => ({ googleDriveConfig: mocks.googleDriveConfig, googleDriveRedirectUri: mocks.googleDriveRedirectUri, createGoogleDriveOAuthClient: mocks.createGoogleDriveOAuthClient }));
vi.mock("@/lib/workspace/connection", () => ({ getPendingWorkspaceConnection: mocks.getPendingWorkspaceConnection, getActiveWorkspaceConnection: mocks.getActiveWorkspaceConnection }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.googleDriveConfig.mockReturnValue({ clientId: "client-id", clientSecret: "client-secret", pickerApiKey: "picker-key", projectNumber: "123456789" });
  mocks.googleDriveRedirectUri.mockReturnValue("https://app.example/admin/google-drive/callback");
  mocks.getPendingWorkspaceConnection.mockResolvedValue(null);
  mocks.getActiveWorkspaceConnection.mockResolvedValue({ refreshToken: "active-refresh", accountEmail: "coach@example.com", folderId: "folder-12345", folderName: "Private slips" });
  mocks.createGoogleDriveOAuthClient.mockReturnValue({ setCredentials: vi.fn(), getAccessToken: vi.fn().mockResolvedValue({ token: "short-lived-access-token" }) });
});

describe("Google Drive Picker-token route", () => {
  it("returns no-store Picker data for the active connection", async () => {
    const response = await GET(new NextRequest("https://app.example/admin/google-drive/picker-token"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accessToken: "short-lived-access-token", appId: "123456789", apiKey: "picker-key", folderId: "folder-12345", folderName: "Private slips" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("prefers the encrypted staged authorization during setup", async () => {
    mocks.getPendingWorkspaceConnection.mockResolvedValue({ refreshToken: "pending-refresh", accountEmail: "new@example.com" });
    const response = await GET(new NextRequest("https://app.example/admin/google-drive/picker-token"));
    expect(response.status).toBe(200);
    expect(mocks.getActiveWorkspaceConnection).not.toHaveBeenCalled();
  });

  it("returns a safe error when OAuth configuration is absent", async () => {
    mocks.googleDriveConfig.mockReturnValue(null);
    const response = await GET(new NextRequest("https://app.example/admin/google-drive/picker-token"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Google Drive connection is not configured." });
  });
});
