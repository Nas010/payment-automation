import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSlipStorageFolder: vi.fn() }));

vi.mock("@/lib/storage/drive-folder", () => ({ getSlipStorageFolder: mocks.getSlipStorageFolder }));

import { GET } from "./route";

describe("health route", () => {
  beforeEach(() => {
    vi.stubEnv("SPREADSHEET_ID", "sheet");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "{}");
    vi.stubEnv("PROMPTPAY_IDENTIFIER", "0812345678");
    vi.stubEnv("RECIPIENT_NAME_EN", "Receiver");
    mocks.getSlipStorageFolder.mockResolvedValue({ folderId: "folder-12345", source: "workbook" });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("reports ready when storage resolves from workbook settings", async () => {
    const response = await GET();
    await expect(response.json()).resolves.toEqual({ ok: true, status: "ready", missing: [] });
  });

  it("reports missing storage without exposing configuration values", async () => {
    mocks.getSlipStorageFolder.mockRejectedValue(new Error("Slip storage folder is not configured."));
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: "needs_configuration", missing: ["SLIP_STORAGE_FOLDER_ID"] });
  });
});
