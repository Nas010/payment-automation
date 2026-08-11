import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const cookieStore = { get: vi.fn() };
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  cookies: vi.fn(),
  googleDriveConfig: vi.fn(),
  googleDriveRedirectUri: vi.fn(),
  decodeDriveCandidate: vi.fn(),
  getGoogleDriveConnection: vi.fn(),
  createGoogleDriveOAuthClient: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/storage/google-drive-auth", () => ({
  googleDriveConfig: mocks.googleDriveConfig,
  googleDriveRedirectUri: mocks.googleDriveRedirectUri,
  decodeDriveCandidate: mocks.decodeDriveCandidate,
  createGoogleDriveOAuthClient: mocks.createGoogleDriveOAuthClient,
}));
vi.mock("@/lib/storage/google-drive-connection", () => ({ getGoogleDriveConnection: mocks.getGoogleDriveConnection }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.cookies.mockResolvedValue(cookieStore);
  cookieStore.get.mockReturnValue(undefined);
  mocks.googleDriveConfig.mockReturnValue({ clientId: "client-id", clientSecret: "client-secret", pickerApiKey: "picker-key", projectNumber: "123456789" });
  mocks.googleDriveRedirectUri.mockReturnValue("https://app.example/admin/google-drive/callback");
  mocks.getGoogleDriveConnection.mockResolvedValue({ refreshToken: "active-refresh", accountEmail: "coach@example.com", folderId: "folder-12345", folderName: "Private slips", validatedAt: "2026-08-11T12:00:00.000Z" });
  mocks.createGoogleDriveOAuthClient.mockReturnValue({
    setCredentials: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue({ token: "short-lived-access-token" }),
  });
});

describe("Google Drive Picker-token route", () => {
  it("returns Picker bootstrap data for the active connection", async () => {
    const response = await GET(new NextRequest("https://app.example/admin/google-drive/picker-token"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accessToken: "short-lived-access-token", appId: "123456789", apiKey: "picker-key", folderId: "folder-12345", folderName: "Private slips" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("prefers encrypted candidate authorization during initial folder selection", async () => {
    cookieStore.get.mockReturnValue({ value: "encrypted-candidate" });
    mocks.decodeDriveCandidate.mockReturnValue({ refreshToken: "candidate-refresh", accountEmail: "new@example.com" });

    const response = await GET(new NextRequest("https://app.example/admin/google-drive/picker-token"));

    expect(response.status).toBe(200);
    expect(mocks.getGoogleDriveConnection).not.toHaveBeenCalled();
    expect(mocks.createGoogleDriveOAuthClient).toHaveBeenCalledWith(expect.objectContaining({ config: expect.anything(), redirectUri: "https://app.example/admin/google-drive/callback" }));
  });

  it("returns safe error when OAuth configuration is absent", async () => {
    mocks.googleDriveConfig.mockReturnValue(null);

    const response = await GET(new NextRequest("https://app.example/admin/google-drive/picker-token"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Google Drive connection is not configured." });
  });
});
