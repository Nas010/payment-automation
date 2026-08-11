import { describe, expect, it, vi } from "vitest";
import { shouldRetainSlip, storeExceptionSlip } from "./slip";

describe("shouldRetainSlip", () => {
  it("retains exception evidence but not automatic receipts by default", () => {
    expect(shouldRetainSlip("REVIEW", 30)).toBe(true);
    expect(shouldRetainSlip("FLAGGED", 30)).toBe(true);
    expect(shouldRetainSlip("AUTO_RECORDED", 30)).toBe(false);
  });
});

describe("storeExceptionSlip", () => {
  it("uses the active resolved folder for each retained slip", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const getSlipStorageFolder = vi.fn().mockResolvedValue({ folderId: "workbook-folder", source: "workbook" });
    const createDriveSlipFile = vi.fn().mockResolvedValue("file-12345");

    await expect(storeExceptionSlip({ bytes, mimeType: "image/png", paymentId: "pay_1", imageHash: "abcdef1234567890" }, { getSlipStorageFolder, createDriveSlipFile })).resolves.toBe("https://drive.google.com/open?id=file-12345");
    expect(createDriveSlipFile).toHaveBeenCalledWith({ bytes, mimeType: "image/png", paymentId: "pay_1", imageHash: "abcdef1234567890", folderId: "workbook-folder" });
  });
});
