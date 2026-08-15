import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LINE_DUE_PROFILES, LINE_DUE_PROFILE_SETTING_KEYS } from "@/lib/line/message-profile";
import { DEFAULT_LINE_WELCOME_TEMPLATE } from "@/lib/line/message-template";

const mocks = vi.hoisted(() => ({
  getPendingGoogleSheets: vi.fn(),
  getPendingWorkspaceConnection: vi.fn(),
  createOAuthDriveClient: vi.fn(),
  testDriveFolderWrite: vi.fn(),
  validateDriveFolder: vi.fn(),
  validateOperationalWorkbook: vi.fn(),
  activatePendingWorkspaceConnection: vi.fn(),
  setInstallationStatus: vi.fn(),
  settingsGet: vi.fn(),
  settingsBatchUpdate: vi.fn(),
}));

vi.mock("@/lib/installation/repository", () => ({ setInstallationStatus: mocks.setInstallationStatus }));
vi.mock("@/lib/sheets/client", () => ({ getPendingGoogleSheets: mocks.getPendingGoogleSheets }));
vi.mock("@/lib/storage/drive-client", () => ({
  createOAuthDriveClient: mocks.createOAuthDriveClient,
  testDriveFolderWrite: mocks.testDriveFolderWrite,
  validateDriveFolder: mocks.validateDriveFolder,
}));
vi.mock("./connection", () => ({
  activatePendingWorkspaceConnection: mocks.activatePendingWorkspaceConnection,
  getPendingWorkspaceConnection: mocks.getPendingWorkspaceConnection,
}));
vi.mock("./workbook", () => ({ validateOperationalWorkbook: mocks.validateOperationalWorkbook }));

import { completeWorkspaceSetup } from "./setup";

const connection = {
  refreshToken: "refresh-token",
  accountGoogleSub: "google-sub-1",
  accountEmail: "owner@example.com",
  spreadsheetId: "sheet-1234567890",
  spreadsheetName: "Coaching Payments - Automated",
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1234567890/edit",
  folderId: "folder-1234567890",
  folderName: "Coaching Payment Slips",
  folderUrl: "https://drive.google.com/drive/folders/folder-1234567890",
};

const config = {
  businessDisplayName: "Coach Bee",
  promptPayType: "phone" as const,
  promptPayIdentifier: "0812345678",
  recipientNameEn: "Bee Example",
  recipientNameTh: "",
  recipientAliases: [],
  publicBaseUrl: "https://pay.example.com",
  slipRetentionDays: 30,
  ocrEnabled: true,
  lineLiffId: "",
  lineLoginChannelId: "",
  lineLinkingEnabled: false,
  lineMessagingEnabled: false,
  lineChatPaymentsEnabled: false,
};

function dependencies() {
  return {
    getPendingWorkspaceConnection: vi.fn().mockResolvedValue(connection),
    validateWorkbook: vi.fn().mockResolvedValue(undefined),
    validateFolder: vi.fn().mockResolvedValue(undefined),
    probeFolder: vi.fn().mockResolvedValue(undefined),
    writeSettings: vi.fn().mockResolvedValue(undefined),
    activateConnection: vi.fn().mockResolvedValue({ ...connection, validatedAt: "2026-08-15T05:00:00.000Z" }),
    setInstallationStatus: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPendingGoogleSheets.mockResolvedValue({
    connection,
    sheets: { spreadsheets: { values: { get: mocks.settingsGet, batchUpdate: mocks.settingsBatchUpdate } } },
  });
  mocks.getPendingWorkspaceConnection.mockResolvedValue(connection);
  mocks.createOAuthDriveClient.mockReturnValue({});
  mocks.validateOperationalWorkbook.mockResolvedValue(undefined);
  mocks.validateDriveFolder.mockResolvedValue(undefined);
  mocks.testDriveFolderWrite.mockResolvedValue(undefined);
  mocks.activatePendingWorkspaceConnection.mockResolvedValue(undefined);
  mocks.setInstallationStatus.mockResolvedValue(undefined);
  mocks.settingsGet.mockResolvedValue({ data: { values: [["key", "value"]] } });
  mocks.settingsBatchUpdate.mockResolvedValue(undefined);
});

describe("complete Workspace setup", () => {
  it("activates only after workbook, folder, QR configuration, and write probes pass", async () => {
    const deps = dependencies();
    await completeWorkspaceSetup({ ownerGoogleSub: "google-sub-1", config }, deps);

    expect(deps.validateWorkbook).toHaveBeenCalledWith(connection.spreadsheetId);
    expect(deps.validateFolder).toHaveBeenCalledWith(connection.folderId);
    expect(deps.probeFolder).toHaveBeenCalledWith(connection.folderId);
    expect(deps.writeSettings).toHaveBeenCalledWith(config);
    expect(deps.activateConnection).toHaveBeenCalledWith({ workbookProbePassed: true, folderProbePassed: true });
    expect(deps.setInstallationStatus).toHaveBeenCalledWith("google-sub-1", "COMPLETE");
    expect(deps.activateConnection.mock.invocationCallOrder[0]).toBeGreaterThan(deps.writeSettings.mock.invocationCallOrder[0]);
  });

  it("preserves the active connection when a folder probe fails", async () => {
    const deps = dependencies();
    deps.probeFolder.mockRejectedValue(new Error("probe failed"));

    await expect(completeWorkspaceSetup({ ownerGoogleSub: "google-sub-1", config }, deps)).rejects.toThrow("probe failed");
    expect(deps.writeSettings).not.toHaveBeenCalled();
    expect(deps.activateConnection).not.toHaveBeenCalled();
    expect(deps.setInstallationStatus).not.toHaveBeenCalled();
  });

  it("rejects a staged token belonging to another account", async () => {
    const deps = dependencies();

    await expect(completeWorkspaceSetup({ ownerGoogleSub: "other-sub", config }, deps)).rejects.toThrow("Google Workspace account does not match the installation owner.");
    expect(deps.validateWorkbook).not.toHaveBeenCalled();
  });

  it("writes both profile defaults for a fresh staged workbook without writing legacy template", async () => {
    await completeWorkspaceSetup({ ownerGoogleSub: "google-sub-1", config });

    const data = mocks.settingsBatchUpdate.mock.calls[0][0].requestBody.data;
    expect(data).toEqual(expect.arrayContaining([
      expect.objectContaining({ values: [["line_liff_id", ""]] }),
      expect.objectContaining({ values: [["line_login_channel_id", ""]] }),
      expect.objectContaining({ values: [["line_welcome_message_template", DEFAULT_LINE_WELCOME_TEMPLATE]] }),
      expect.objectContaining({ values: [[LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME, JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME)]] }),
      expect.objectContaining({ values: [[LINE_DUE_PROFILE_SETTING_KEYS.INSTALLMENTS, JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS)]] }),
    ]));
    expect(data.flatMap((entry: { values: string[][] }) => entry.values).map((row: string[]) => row[0])).not.toContain("line_due_message_template");
  });
});
