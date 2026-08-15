import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveWorkspaceConnection: vi.fn(),
  googleDriveConfig: vi.fn(),
  oauthConstructor: vi.fn(),
  sheetsFactory: vi.fn(),
}));

vi.mock("@/lib/workspace/connection", () => ({ getActiveWorkspaceConnection: mocks.getActiveWorkspaceConnection }));
vi.mock("@/lib/config", () => ({ googleDriveConfig: mocks.googleDriveConfig, googleDriveRedirectUri: () => "http://localhost:3000/admin/google-drive/callback" }));
vi.mock("googleapis", () => ({ google: { auth: { OAuth2: mocks.oauthConstructor }, sheets: mocks.sheetsFactory } }));

import { getGoogleSheets } from "./client";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveWorkspaceConnection.mockResolvedValue({ refreshToken: "refresh-token", spreadsheetId: "operational-sheet-123" });
  mocks.googleDriveConfig.mockReturnValue({ clientId: "client-id", clientSecret: "client-secret", pickerApiKey: "picker", projectNumber: "123" });
  mocks.oauthConstructor.mockImplementation(function OAuth(this: { setCredentials: ReturnType<typeof vi.fn> }) { this.setCredentials = vi.fn(); });
  mocks.sheetsFactory.mockReturnValue({ api: "sheets" });
});

describe("operational Google Sheets client", () => {
  it("uses the active owner's refresh token and operational spreadsheet ID", async () => {
    await expect(getGoogleSheets()).resolves.toEqual({ sheets: { api: "sheets" }, spreadsheetId: "operational-sheet-123" });
    const oauth = mocks.oauthConstructor.mock.instances[0] as unknown as { setCredentials: ReturnType<typeof vi.fn> };
    expect(oauth.setCredentials).toHaveBeenCalledWith({ refresh_token: "refresh-token" });
  });

  it("fails safely when setup has no active Workspace connection", async () => {
    mocks.getActiveWorkspaceConnection.mockResolvedValue(null);
    await expect(getGoogleSheets()).rejects.toThrow("Google Workspace is not connected.");
    expect(mocks.sheetsFactory).not.toHaveBeenCalled();
  });
});
