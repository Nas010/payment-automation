import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  validateDriveFolder: vi.fn(),
  upsertOperationalSettings: vi.fn(),
  appendAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/storage/drive-client", () => ({ validateDriveFolder: mocks.validateDriveFolder }));
vi.mock("@/lib/sheets/settings", () => ({ upsertOperationalSettings: mocks.upsertOperationalSettings }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { saveAndTestDriveFolderAction } from "./drive-actions";

const folderId = "11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.validateDriveFolder.mockResolvedValue({ folderId, folderName: "Private payment slips", validatedAt: "2026-08-11T12:00:00.000Z" });
  mocks.upsertOperationalSettings.mockResolvedValue(undefined);
  mocks.appendAudit.mockResolvedValue(undefined);
});

describe("saveAndTestDriveFolderAction", () => {
  it("validates before atomically activating the folder and audits no identifier", async () => {
    const formData = new FormData();
    formData.set("folder", `https://drive.google.com/drive/folders/${folderId}?usp=sharing`);

    await expect(saveAndTestDriveFolderAction(formData)).resolves.toEqual({ ok: true, status: "VALID", message: "Google Drive folder connected.", folderName: "Private payment slips", validatedAt: "2026-08-11T12:00:00.000Z" });
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.validateDriveFolder).toHaveBeenCalledWith(folderId);
    expect(mocks.upsertOperationalSettings).toHaveBeenCalledWith([
      { key: "slip_storage_folder_id", value: folderId },
      { key: "slip_storage_validation", value: JSON.stringify({ status: "VALID", folderName: "Private payment slips", validatedAt: "2026-08-11T12:00:00.000Z" }) },
    ]);
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DRIVE_STORAGE_UPDATED", metadata: JSON.stringify({ settingKey: "slip_storage_folder_id", source: "ADMIN", validatedAt: "2026-08-11T12:00:00.000Z" }) }));
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain(folderId);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("preserves active settings and sanitizes failed validation", async () => {
    mocks.validateDriveFolder.mockRejectedValue(new Error("private Google response"));
    const formData = new FormData();
    formData.set("folder", folderId);

    await expect(saveAndTestDriveFolderAction(formData)).resolves.toMatchObject({ ok: false, status: "FAILED", message: "Could not validate Google Drive folder. Try again." });
    expect(mocks.upsertOperationalSettings).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain(folderId);
    expect(JSON.stringify(await saveAndTestDriveFolderAction(formData))).not.toContain("private Google response");
  });

  it("requires admin before parsing or contacting Drive", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("Unauthorized"));
    await expect(saveAndTestDriveFolderAction(new FormData())).rejects.toThrow("Unauthorized");
    expect(mocks.validateDriveFolder).not.toHaveBeenCalled();
    expect(mocks.upsertOperationalSettings).not.toHaveBeenCalled();
  });
});
