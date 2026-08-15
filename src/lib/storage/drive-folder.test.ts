import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getActiveWorkspaceConnection: vi.fn() }));
vi.mock("@/lib/workspace/connection", () => ({ getActiveWorkspaceConnection: mocks.getActiveWorkspaceConnection }));

import { getSlipStorageFolder, parseDriveFolderId } from "./drive-folder";

describe("parseDriveFolderId", () => {
  it("accepts a raw folder ID and a Drive folder URL", () => {
    const folderId = "11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD";
    expect(parseDriveFolderId(folderId)).toBe(folderId);
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${folderId}?usp=sharing`)).toBe(folderId);
    expect(parseDriveFolderId(`https://drive.google.com/drive/u/1/folders/${folderId}`)).toBe(folderId);
  });

  it("rejects non-Drive and Drive file URLs", () => {
    expect(() => parseDriveFolderId("https://example.com/drive/folders/abc1234567")).toThrow("Invalid Google Drive folder URL or ID.");
    expect(() => parseDriveFolderId("https://drive.google.com/file/d/11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD/view")).toThrow("Invalid Google Drive folder URL or ID.");
  });
});

describe("getSlipStorageFolder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses only the active owner Workspace folder", async () => {
    mocks.getActiveWorkspaceConnection.mockResolvedValue({ folderId: "oauth-folder-12345", folderName: "Private slips" });
    await expect(getSlipStorageFolder()).resolves.toEqual({ folderId: "oauth-folder-12345", source: "oauth", folderName: "Private slips" });
  });

  it("rejects missing active Workspace instead of using environment fallbacks", async () => {
    vi.stubEnv("SLIP_STORAGE_FOLDER_ID", "environment-folder");
    mocks.getActiveWorkspaceConnection.mockResolvedValue(null);
    await expect(getSlipStorageFolder()).rejects.toThrow("Slip storage folder is not configured.");
  });
});
