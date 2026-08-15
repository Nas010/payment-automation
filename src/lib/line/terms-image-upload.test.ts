import { describe, expect, it, vi } from "vitest";
import { uploadLineTermsImage } from "./terms-image-upload";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function dependencies() {
  return {
    getFolder: vi.fn().mockResolvedValue({ folderId: "folder-12345", folderName: "Payment files", source: "oauth" as const }),
    createFile: vi.fn().mockResolvedValue("terms-file-12345"),
    saveVersion: vi.fn().mockResolvedValue(undefined),
    createId: vi.fn().mockReturnValueOnce("11111111111111111111111111111111").mockReturnValueOnce("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    now: vi.fn().mockReturnValue("2026-08-15T01:00:00.000Z"),
  };
}

describe("uploadLineTermsImage", () => {
  it("stores image bytes before activating immutable metadata", async () => {
    const deps = dependencies();
    const result = await uploadLineTermsImage({ bytes: png, originalName: "terms.png" }, deps);

    expect(result).toEqual({
      versionId: "terms_11111111111111111111111111111111",
      publicToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      driveFileId: "terms-file-12345",
      mimeType: "image/png",
      byteLength: 8,
      originalName: "terms.png",
      uploadedAt: "2026-08-15T01:00:00.000Z",
    });
    expect(deps.createFile.mock.invocationCallOrder[0]).toBeLessThan(deps.saveVersion.mock.invocationCallOrder[0]);
    expect(deps.createFile).toHaveBeenCalledWith(expect.objectContaining({ folderId: "folder-12345", bytes: png }));
    expect(deps.saveVersion).toHaveBeenCalledWith(result);
  });

  it("does not activate metadata when Drive creation fails", async () => {
    const deps = dependencies();
    deps.createFile.mockRejectedValue(new Error("Could not store T&S image. Try again."));

    await expect(uploadLineTermsImage({ bytes: png, originalName: "terms.png" }, deps)).rejects.toThrow("Could not store T&S image. Try again.");
    expect(deps.saveVersion).not.toHaveBeenCalled();
  });

  it("rejects invalid bytes before reading configured Drive state", async () => {
    const deps = dependencies();
    await expect(uploadLineTermsImage({ bytes: new Uint8Array([1]), originalName: "fake.png" }, deps)).rejects.toThrow("Choose a JPEG or PNG image.");
    expect(deps.getFolder).not.toHaveBeenCalled();
    expect(deps.createFile).not.toHaveBeenCalled();
  });
});
