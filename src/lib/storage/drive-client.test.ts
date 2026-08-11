import { describe, expect, it, vi } from "vitest";
import { createDriveSlipFile, testDriveFolderWrite, validateDriveFolder, type DriveClientLike } from "./drive-client";

function driveWith({ folder, getError, createdId = "file-12345", deleteError }: { folder?: Record<string, unknown>; getError?: unknown; createdId?: string | null; deleteError?: unknown } = {}) {
  const get = vi.fn().mockImplementation(async () => {
    if (getError) throw getError;
    return { data: folder };
  });
  const create = vi.fn().mockResolvedValue({ data: { id: createdId } });
  const deleteFile = vi.fn().mockImplementation(async () => {
    if (deleteError) throw deleteError;
    return {};
  });
  return { drive: { files: { get, create, delete: deleteFile } } as unknown as DriveClientLike, get, create, deleteFile };
}

const writableFolder = {
  id: "folder-12345",
  name: "Private payment slips",
  mimeType: "application/vnd.google-apps.folder",
  trashed: false,
  capabilities: { canAddChildren: true },
};

describe("validateDriveFolder", () => {
  it("accepts a visible writable folder using shared-drive-safe metadata lookup", async () => {
    const { drive, get } = driveWith({ folder: writableFolder });
    await expect(validateDriveFolder("folder-12345", { drive, now: () => "2026-08-11T12:00:00.000Z" })).resolves.toEqual({
      folderId: "folder-12345",
      folderName: "Private payment slips",
      validatedAt: "2026-08-11T12:00:00.000Z",
    });
    expect(get).toHaveBeenCalledWith({ fileId: "folder-12345", fields: "id,name,mimeType,trashed,capabilities(canAddChildren)", supportsAllDrives: true });
  });

  it("returns stable errors for unavailable and invalid folder states", async () => {
    await expect(validateDriveFolder("folder-12345", { drive: driveWith({ getError: { code: 404, message: "private Google body" } }).drive })).rejects.toThrow("Folder not found. Share it with the service-account email and try again.");
    await expect(validateDriveFolder("folder-12345", { drive: driveWith({ folder: { ...writableFolder, mimeType: "image/png" } }).drive })).rejects.toThrow("Selected Drive item is not a folder.");
    await expect(validateDriveFolder("folder-12345", { drive: driveWith({ folder: { ...writableFolder, trashed: true } }).drive })).rejects.toThrow("Selected Drive folder is in trash.");
    await expect(validateDriveFolder("folder-12345", { drive: driveWith({ folder: { ...writableFolder, capabilities: { canAddChildren: false } } }).drive })).rejects.toThrow("Service account needs Editor access to this folder.");
  });

  it("sanitizes unexpected Google failures", async () => {
    await expect(validateDriveFolder("folder-12345", { drive: driveWith({ getError: new Error("private Google body") }).drive })).rejects.toThrow("Could not validate Google Drive folder. Try again.");
  });
});

describe("createDriveSlipFile", () => {
  it("creates a private slip under the selected folder and returns only its file ID", async () => {
    const { drive, create } = driveWith();
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(createDriveSlipFile({ bytes, mimeType: "image/png", paymentId: "pay_1", imageHash: "abcdef1234567890", folderId: "folder-12345" }, { drive })).resolves.toBe("file-12345");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { name: "slip-pay_1-abcdef123456", parents: ["folder-12345"], mimeType: "image/png" },
      media: expect.objectContaining({ mimeType: "image/png" }),
      fields: "id",
      supportsAllDrives: true,
    }));
  });
});

describe("testDriveFolderWrite", () => {
  it("creates and removes a zero-content probe in the selected folder", async () => {
    const { drive, create, deleteFile } = driveWith({ createdId: "probe-12345" });

    await expect(testDriveFolderWrite("folder-12345", drive, { now: () => "2026-08-11T12:00:00.000Z" })).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { name: "coaching-payments-drive-probe-2026-08-11T12-00-00-000Z", parents: ["folder-12345"], mimeType: "text/plain" },
      fields: "id",
      supportsAllDrives: true,
    }));
    expect(deleteFile).toHaveBeenCalledWith({ fileId: "probe-12345", supportsAllDrives: true });
  });

  it("fails when probe cleanup cannot complete", async () => {
    const { drive } = driveWith({ createdId: "probe-12345", deleteError: new Error("private Google response") });

    await expect(testDriveFolderWrite("folder-12345", drive)).rejects.toThrow("Could not validate Google Drive folder. Try again.");
  });
});
