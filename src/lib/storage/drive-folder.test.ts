import { describe, expect, it, vi } from "vitest";
import { getSlipStorageFolder, parseDriveFolderId, selectSlipStorageFolderId, serviceAccountEmail } from "./drive-folder";

describe("parseDriveFolderId", () => {
  it("accepts a raw folder ID and a Drive folder URL", () => {
    const folderId = "11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD";
    expect(parseDriveFolderId(folderId)).toBe(folderId);
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${folderId}?usp=sharing`)).toBe(folderId);
  });

  it("rejects non-Drive and Drive file URLs", () => {
    expect(() => parseDriveFolderId("https://example.com/drive/folders/abc1234567")).toThrow("Invalid Google Drive folder URL or ID.");
    expect(() => parseDriveFolderId("https://drive.google.com/file/d/11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD/view")).toThrow("Invalid Google Drive folder URL or ID.");
  });
});

describe("serviceAccountEmail", () => {
  it("returns only a valid service-account email", () => {
    expect(serviceAccountEmail(JSON.stringify({ client_email: "payments@example.iam.gserviceaccount.com", private_key: "private" }))).toBe("payments@example.iam.gserviceaccount.com");
    expect(() => serviceAccountEmail("{}")).toThrow("Google service account is not configured correctly.");
    expect(() => serviceAccountEmail("not-json")).toThrow("Google service account is not configured correctly.");
  });
});

describe("selectSlipStorageFolderId", () => {
  it("prefers workbook configuration over environment fallback", () => {
    expect(selectSlipStorageFolderId([{ key: "slip_storage_folder_id", value: "workbook-folder" }], { SLIP_STORAGE_FOLDER_ID: "environment-folder" })).toEqual({ folderId: "workbook-folder", source: "workbook" });
    expect(selectSlipStorageFolderId([], { SLIP_STORAGE_FOLDER_ID: "environment-folder" })).toEqual({ folderId: "environment-folder", source: "environment" });
    expect(selectSlipStorageFolderId([], { SLIP_STORAGE_FOLDER_ID: "CONFIG_REQUIRED" })).toBeNull();
  });
});

describe("getSlipStorageFolder", () => {
  it("uses workbook settings when readable", async () => {
    await expect(getSlipStorageFolder({
      listSettings: vi.fn().mockResolvedValue([{ rowNumber: 2, key: "slip_storage_folder_id", value: "workbook-folder" }]),
      environment: { SLIP_STORAGE_FOLDER_ID: "environment-folder" },
    })).resolves.toEqual({ folderId: "workbook-folder", source: "workbook" });
  });

  it("falls back to environment when Settings cannot be read", async () => {
    await expect(getSlipStorageFolder({
      listSettings: vi.fn().mockRejectedValue(new Error("Sheets unavailable")),
      environment: { SLIP_STORAGE_FOLDER_ID: "environment-folder" },
    })).resolves.toEqual({ folderId: "environment-folder", source: "environment" });
  });

  it("rejects missing workbook and environment configuration", async () => {
    await expect(getSlipStorageFolder({ listSettings: vi.fn().mockResolvedValue([]), environment: {} })).rejects.toThrow("Slip storage folder is not configured.");
  });
});
