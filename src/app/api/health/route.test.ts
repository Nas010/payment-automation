import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requiredConfiguration: vi.fn(),
  getInstallation: vi.fn(),
  getActiveWorkspaceConnection: vi.fn(),
  getGoogleSheets: vi.fn(),
  createOAuthDriveClient: vi.fn(),
  validateDriveFolder: vi.fn(),
  runtimeConfig: vi.fn(),
  workbookGet: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ requiredConfiguration: mocks.requiredConfiguration }));
vi.mock("@/lib/installation/repository", () => ({ getInstallation: mocks.getInstallation }));
vi.mock("@/lib/workspace/connection", () => ({ getActiveWorkspaceConnection: mocks.getActiveWorkspaceConnection }));
vi.mock("@/lib/sheets/client", () => ({ getGoogleSheets: mocks.getGoogleSheets }));
vi.mock("@/lib/storage/drive-client", () => ({ createOAuthDriveClient: mocks.createOAuthDriveClient, validateDriveFolder: mocks.validateDriveFolder }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requiredConfiguration.mockReturnValue([]);
  mocks.getInstallation.mockResolvedValue({ setupStatus: "COMPLETE" });
  mocks.getActiveWorkspaceConnection.mockResolvedValue({ spreadsheetId: "sheet-id", folderId: "folder-id" });
  mocks.getGoogleSheets.mockResolvedValue({ spreadsheetId: "sheet-id", sheets: { spreadsheets: { get: mocks.workbookGet } } });
  mocks.workbookGet.mockResolvedValue({});
  mocks.createOAuthDriveClient.mockReturnValue({});
  mocks.validateDriveFolder.mockResolvedValue({});
  mocks.runtimeConfig.mockResolvedValue({ businessDisplayName: "Coach Bee" });
});

describe("health route", () => {
  it("reports only safe ready categories", async () => {
    const response = await GET();
    await expect(response.json()).resolves.toEqual({ ok: true, status: "ready", checks: { bootstrap: "ready", owner: "ready", workspace: "ready", workbook: "ready", folder: "ready", business: "ready" } });
  });

  it("reports a revoked folder connection without exposing IDs or vendor errors", async () => {
    mocks.validateDriveFolder.mockRejectedValue(new Error("private folder-id response"));
    const body = await (await GET()).json();
    expect(body).toMatchObject({ status: "needs_configuration", checks: { folder: "attention" } });
    expect(JSON.stringify(body)).not.toContain("folder-id");
    expect(JSON.stringify(body)).not.toContain("private");
  });
});
