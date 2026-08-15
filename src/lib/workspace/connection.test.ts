import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSecretRecord: vi.fn(), upsertSecretRecord: vi.fn() }));
vi.mock("@/lib/secrets/repository", () => ({ getSecretRecord: mocks.getSecretRecord, upsertSecretRecord: mocks.upsertSecretRecord }));

import { decryptSecret } from "@/lib/secrets/crypto";
import {
  activatePendingWorkspaceConnection,
  getActiveWorkspaceConnection,
  savePendingWorkspaceConnection,
} from "./connection";

const encryptionKey = Buffer.alloc(32, 13).toString("base64");
const pending = {
  refreshToken: "pending-refresh-token",
  accountGoogleSub: "google-sub-1",
  accountEmail: "owner@example.com",
  spreadsheetId: "sheet-1234567890",
  spreadsheetName: "Coaching Payments - Automated",
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1234567890/edit",
  folderId: "folder-1234567890",
  folderName: "Coaching Payment Slips",
  folderUrl: "https://drive.google.com/drive/folders/folder-1234567890",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
  mocks.getSecretRecord.mockResolvedValue(null);
  mocks.upsertSecretRecord.mockResolvedValue(undefined);
});

describe("staged Google Workspace connection", () => {
  it("stores a pending connection without replacing the active connection", async () => {
    await savePendingWorkspaceConnection(pending);

    expect(mocks.upsertSecretRecord).toHaveBeenCalledTimes(1);
    const write = mocks.upsertSecretRecord.mock.calls[0][0];
    expect(write.keyName).toBe("google_workspace_pending");
    expect(JSON.stringify(write)).not.toContain(pending.refreshToken);
    await expect(getActiveWorkspaceConnection()).resolves.toBeNull();
  });

  it("activates only a complete pending connection after both probes report success", async () => {
    await savePendingWorkspaceConnection(pending);
    const pendingWrite = mocks.upsertSecretRecord.mock.calls[0][0];
    mocks.getSecretRecord.mockImplementation(async (key: string) => key === "google_workspace_pending" ? { rowNumber: 2, ...pendingWrite } : null);

    await expect(activatePendingWorkspaceConnection({ workbookProbePassed: false, folderProbePassed: true })).rejects.toThrow("Both Google Workspace probes must pass");
    expect(mocks.upsertSecretRecord).toHaveBeenCalledTimes(1);

    const active = await activatePendingWorkspaceConnection({ workbookProbePassed: true, folderProbePassed: true }, new Date("2026-08-15T04:00:00.000Z"));
    expect(active).toEqual({ ...pending, validatedAt: "2026-08-15T04:00:00.000Z" });
    const activeWrite = mocks.upsertSecretRecord.mock.calls[1][0];
    expect(activeWrite.keyName).toBe("google_workspace_connection");
    expect(JSON.parse(decryptSecret({ keyName: activeWrite.keyName, record: activeWrite }))).toEqual(active);
  });
});
