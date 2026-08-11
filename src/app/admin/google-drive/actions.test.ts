import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = { get: vi.fn(), delete: vi.fn() };
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  cookies: vi.fn(),
  googleDriveConfig: vi.fn(),
  googleDriveRedirectUri: vi.fn(),
  decodeDriveCandidate: vi.fn(),
  createGoogleDriveOAuthClient: vi.fn(),
  createOAuthDriveClient: vi.fn(),
  getGoogleDriveConnection: vi.fn(),
  saveGoogleDriveConnection: vi.fn(),
  validateDriveFolder: vi.fn(),
  testDriveFolderWrite: vi.fn(),
  appendAudit: vi.fn(),
  revalidatePath: vi.fn(),
  parseDriveFolderId: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/storage/google-drive-auth", () => ({
  googleDriveConfig: mocks.googleDriveConfig,
  googleDriveRedirectUri: mocks.googleDriveRedirectUri,
  decodeDriveCandidate: mocks.decodeDriveCandidate,
  createGoogleDriveOAuthClient: mocks.createGoogleDriveOAuthClient,
}));
vi.mock("@/lib/storage/google-drive-connection", () => ({
  getGoogleDriveConnection: mocks.getGoogleDriveConnection,
  saveGoogleDriveConnection: mocks.saveGoogleDriveConnection,
}));
vi.mock("@/lib/storage/drive-client", () => ({
  createOAuthDriveClient: mocks.createOAuthDriveClient,
  validateDriveFolder: mocks.validateDriveFolder,
  testDriveFolderWrite: mocks.testDriveFolderWrite,
}));
vi.mock("@/lib/storage/drive-folder", () => ({ parseDriveFolderId: mocks.parseDriveFolderId }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit }));

import { activateGoogleDriveFolderAction } from "./actions";

const candidate = { refreshToken: "candidate-refresh", accountEmail: "new@example.com" };
const active = { refreshToken: "active-refresh", accountEmail: "coach@example.com", folderId: "old-folder-12345", folderName: "Old folder", validatedAt: "2026-08-11T11:00:00.000Z" };
const formData = () => {
  const data = new FormData();
  data.set("folder_id", "new-folder-12345");
  data.set("folder_name", "New folder");
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.cookies.mockResolvedValue(cookieStore);
  cookieStore.get.mockReturnValue({ value: "encrypted-candidate" });
  mocks.googleDriveConfig.mockReturnValue({ clientId: "client-id", clientSecret: "client-secret", pickerApiKey: "picker-key", projectNumber: "123456789" });
  mocks.googleDriveRedirectUri.mockReturnValue("https://app.example/admin/google-drive/callback");
  mocks.decodeDriveCandidate.mockReturnValue(candidate);
  mocks.createGoogleDriveOAuthClient.mockReturnValue({});
  mocks.createOAuthDriveClient.mockReturnValue({});
  mocks.getGoogleDriveConnection.mockResolvedValue(active);
  mocks.parseDriveFolderId.mockReturnValue("new-folder-12345");
  mocks.validateDriveFolder.mockResolvedValue({ folderId: "new-folder-12345", folderName: "New folder", validatedAt: "2026-08-11T12:00:00.000Z" });
  mocks.testDriveFolderWrite.mockResolvedValue(undefined);
  mocks.saveGoogleDriveConnection.mockResolvedValue(undefined);
  mocks.appendAudit.mockResolvedValue(undefined);
});

describe("activateGoogleDriveFolderAction", () => {
  it("validates, probes, saves, audits safely, and clears a candidate", async () => {
    await expect(activateGoogleDriveFolderAction(formData())).resolves.toEqual({
      ok: true,
      status: "CONNECTED",
      message: "Google Drive folder connected.",
      accountEmail: "new@example.com",
      folderName: "New folder",
      validatedAt: "2026-08-11T12:00:00.000Z",
    });

    expect(mocks.getGoogleDriveConnection).not.toHaveBeenCalled();
    expect(mocks.validateDriveFolder).toHaveBeenCalledWith("new-folder-12345", expect.objectContaining({ permissionMessage: "Connected Google account needs Editor access to this folder." }));
    expect(mocks.testDriveFolderWrite).toHaveBeenCalledWith("new-folder-12345", expect.anything());
    expect(mocks.saveGoogleDriveConnection).toHaveBeenCalledWith({ refreshToken: "candidate-refresh", accountEmail: "new@example.com", folderId: "new-folder-12345", folderName: "New folder", validatedAt: "2026-08-11T12:00:00.000Z" });
    expect(cookieStore.delete).toHaveBeenCalledWith("google_drive_candidate");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("new-folder-12345");
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("candidate-refresh");
  });

  it("uses the active authorization when changing only the folder", async () => {
    cookieStore.get.mockReturnValue(undefined);

    await expect(activateGoogleDriveFolderAction(formData())).resolves.toMatchObject({ ok: true, accountEmail: "coach@example.com" });
    expect(mocks.getGoogleDriveConnection).toHaveBeenCalledTimes(1);
    expect(mocks.saveGoogleDriveConnection).toHaveBeenCalledWith({ refreshToken: "active-refresh", accountEmail: "coach@example.com", folderId: "new-folder-12345", folderName: "New folder", validatedAt: "2026-08-11T12:00:00.000Z" });
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("preserves the old connection and candidate after validation failure", async () => {
    mocks.validateDriveFolder.mockRejectedValue(new Error("private Google response"));

    await expect(activateGoogleDriveFolderAction(formData())).resolves.toMatchObject({ ok: false, status: "FAILED", message: "Could not connect Google Drive. Try again." });
    expect(mocks.saveGoogleDriveConnection).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("private Google response");
  });

  it("requires admin before reading candidate or contacting Drive", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("Unauthorized"));

    await expect(activateGoogleDriveFolderAction(formData())).rejects.toThrow("Unauthorized");
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.validateDriveFolder).not.toHaveBeenCalled();
  });
});
