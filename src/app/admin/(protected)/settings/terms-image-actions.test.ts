import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  uploadLineTermsImage: vi.fn(),
  appendAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/line/terms-image-upload", () => ({ uploadLineTermsImage: mocks.uploadLineTermsImage }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { uploadLineTermsImageAction } from "./terms-image-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.uploadLineTermsImage.mockResolvedValue({
    versionId: "terms_11111111111111111111111111111111",
    publicToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    driveFileId: "terms-file-12345",
    mimeType: "image/png",
    byteLength: 8,
    originalName: "terms.png",
    uploadedAt: "2026-08-15T01:00:00.000Z",
  });
  mocks.appendAudit.mockResolvedValue(undefined);
});

describe("uploadLineTermsImageAction", () => {
  it("requires admin, uploads bytes, audits safe metadata, and revalidates Settings", async () => {
    const formData = new FormData();
    formData.set("terms_image", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "terms.png", { type: "image/png" }));

    await expect(uploadLineTermsImageAction(formData)).resolves.toEqual({ ok: true, status: "SAVED", message: "T&S image saved." });
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.uploadLineTermsImage).toHaveBeenCalledWith(expect.objectContaining({ originalName: "terms.png", bytes: expect.any(Uint8Array) }));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "LINE_TERMS_IMAGE_SAVED",
      metadata: JSON.stringify({ versionId: "terms_11111111111111111111111111111111", mimeType: "image/png", byteLength: 8 }),
    }));
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("terms-file-12345");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("returns a safe failure without audit data when upload fails", async () => {
    mocks.uploadLineTermsImage.mockRejectedValue(new Error("private Google body"));
    const formData = new FormData();
    formData.set("terms_image", new File(["bad"], "terms.png", { type: "image/png" }));

    await expect(uploadLineTermsImageAction(formData)).resolves.toEqual({ ok: false, status: "FAILED", message: "Could not save T&S image. Try again." });
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("rejects a missing image before upload", async () => {
    await expect(uploadLineTermsImageAction(new FormData())).resolves.toEqual({ ok: false, status: "FAILED", message: "Choose a JPEG or PNG image." });
    expect(mocks.uploadLineTermsImage).not.toHaveBeenCalled();
  });
});
