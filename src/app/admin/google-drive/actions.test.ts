import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  googleDriveConfig: vi.fn(),
  createOAuthDriveClient: vi.fn(),
  getPendingWorkspaceConnection: vi.fn(),
  getActiveWorkspaceConnection: vi.fn(),
  savePendingWorkspaceConnection: vi.fn(),
  activatePendingWorkspaceConnection: vi.fn(),
  getPendingGoogleSheets: vi.fn(),
  validateOperationalWorkbook: vi.fn(),
  validateDriveFolder: vi.fn(),
  testDriveFolderWrite: vi.fn(),
  appendAudit: vi.fn(),
  revalidatePath: vi.fn(),
  parseDriveFolderId: vi.fn(),
  setInstallationStatus: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/installation/repository", () => ({ setInstallationStatus: mocks.setInstallationStatus }));
vi.mock("@/lib/storage/google-drive-auth", () => ({ googleDriveConfig: mocks.googleDriveConfig }));
vi.mock("@/lib/storage/drive-client", () => ({ createOAuthDriveClient: mocks.createOAuthDriveClient, validateDriveFolder: mocks.validateDriveFolder, testDriveFolderWrite: mocks.testDriveFolderWrite }));
vi.mock("@/lib/storage/drive-folder", () => ({ parseDriveFolderId: mocks.parseDriveFolderId }));
vi.mock("@/lib/workspace/connection", () => ({ getPendingWorkspaceConnection: mocks.getPendingWorkspaceConnection, getActiveWorkspaceConnection: mocks.getActiveWorkspaceConnection, savePendingWorkspaceConnection: mocks.savePendingWorkspaceConnection, activatePendingWorkspaceConnection: mocks.activatePendingWorkspaceConnection }));
vi.mock("@/lib/sheets/client", () => ({ getPendingGoogleSheets: mocks.getPendingGoogleSheets }));
vi.mock("@/lib/workspace/workbook", () => ({ validateOperationalWorkbook: mocks.validateOperationalWorkbook }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit }));

import { activateGoogleDriveFolderAction } from "./actions";

const pending = { refreshToken: "pending-refresh", accountGoogleSub: "sub-1", accountEmail: "owner@example.com", spreadsheetId: "sheet-1234567890", spreadsheetName: "Workbook", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1234567890/edit" };
const active = { ...pending, folderId: "old-folder-12345", folderName: "Old folder", folderUrl: "https://drive.google.com/drive/folders/old-folder-12345", validatedAt: "2026-08-11T11:00:00.000Z" };

function formData() {
  const data = new FormData();
  data.set("folder_id", "new-folder-12345");
  data.set("folder_name", "New folder");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ sub: "sub-1" });
  mocks.googleDriveConfig.mockReturnValue({ clientId: "client", clientSecret: "secret", pickerApiKey: "picker", projectNumber: "123" });
  mocks.getPendingWorkspaceConnection.mockResolvedValue(pending);
  mocks.getActiveWorkspaceConnection.mockResolvedValue(null);
  mocks.parseDriveFolderId.mockReturnValue("new-folder-12345");
  mocks.createOAuthDriveClient.mockReturnValue({});
  mocks.validateDriveFolder.mockResolvedValue({ folderId: "new-folder-12345", folderName: "New folder", validatedAt: "2026-08-11T12:00:00.000Z" });
  mocks.testDriveFolderWrite.mockResolvedValue(undefined);
  mocks.savePendingWorkspaceConnection.mockResolvedValue(undefined);
  mocks.getPendingGoogleSheets.mockResolvedValue({ sheets: {} });
  mocks.validateOperationalWorkbook.mockResolvedValue(undefined);
  mocks.activatePendingWorkspaceConnection.mockResolvedValue(undefined);
  mocks.appendAudit.mockResolvedValue(undefined);
  mocks.setInstallationStatus.mockResolvedValue(undefined);
});

describe("activateGoogleDriveFolderAction", () => {
  it("stages a probed folder during setup without activating early", async () => {
    await expect(activateGoogleDriveFolderAction(formData())).resolves.toMatchObject({ ok: true, accountEmail: "owner@example.com", folderName: "New folder" });
    expect(mocks.savePendingWorkspaceConnection).toHaveBeenCalledWith({ ...pending, folderId: "new-folder-12345", folderName: "New folder", folderUrl: "https://drive.google.com/drive/folders/new-folder-12345" });
    expect(mocks.activatePendingWorkspaceConnection).not.toHaveBeenCalled();
    expect(mocks.setInstallationStatus).toHaveBeenCalledWith("sub-1", "WORKSPACE_CONNECTED");
  });

  it("revalidates workbook and folder before replacing an active folder", async () => {
    mocks.getPendingWorkspaceConnection.mockResolvedValue(null);
    mocks.getActiveWorkspaceConnection.mockResolvedValue(active);
    await expect(activateGoogleDriveFolderAction(formData())).resolves.toMatchObject({ ok: true });
    expect(mocks.validateOperationalWorkbook).toHaveBeenCalledWith("sheet-1234567890", {});
    expect(mocks.activatePendingWorkspaceConnection).toHaveBeenCalledWith({ workbookProbePassed: true, folderProbePassed: true });
  });

  it("preserves active and staged connections after a probe failure", async () => {
    mocks.testDriveFolderWrite.mockRejectedValue(new Error("private response"));
    await expect(activateGoogleDriveFolderAction(formData())).resolves.toMatchObject({ ok: false, message: "Could not connect Google Drive. Try again." });
    expect(mocks.savePendingWorkspaceConnection).not.toHaveBeenCalled();
    expect(mocks.activatePendingWorkspaceConnection).not.toHaveBeenCalled();
  });

  it("requires admin before contacting Google", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("Unauthorized"));
    await expect(activateGoogleDriveFolderAction(formData())).rejects.toThrow("Unauthorized");
    expect(mocks.validateDriveFolder).not.toHaveBeenCalled();
  });
});
