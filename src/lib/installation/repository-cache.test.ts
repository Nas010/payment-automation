import { beforeEach, describe, expect, it, vi } from "vitest";

const { batchUpdate, metadataGet, valuesGet, valuesUpdate } = vi.hoisted(() => ({
  batchUpdate: vi.fn(),
  metadataGet: vi.fn(),
  valuesGet: vi.fn(),
  valuesUpdate: vi.fn(),
}));

vi.mock("@/lib/sheets/bootstrap-client", () => ({
  getBootstrapSheets: () => ({
    spreadsheetId: "bootstrap-sheet",
    sheets: { spreadsheets: { get: metadataGet, batchUpdate, values: { get: valuesGet, update: valuesUpdate } } },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  metadataGet.mockResolvedValue({
    data: { sheets: [{ properties: { sheetId: 71, title: "Installation", gridProperties: { columnCount: 5 } } }], namedRanges: [] },
  });
  valuesGet.mockResolvedValue({ data: { values: [["owner_google_sub", "owner_email", "setup_status", "created_at", "updated_at"]] } });
});

describe("Installation schema quota cache", () => {
  it("reuses one successful schema check across repeated owner reads", async () => {
    const { getInstallation } = await import("./repository");

    await getInstallation();
    await getInstallation();

    expect(metadataGet).toHaveBeenCalledTimes(1);
    expect(valuesGet).toHaveBeenCalledTimes(3);
  });

  it("retries schema setup after a transient quota failure", async () => {
    metadataGet.mockRejectedValueOnce(Object.assign(new Error("quota"), { response: { status: 429 } }));
    const { getInstallation } = await import("./repository");

    await expect(getInstallation()).rejects.toThrow("quota");
    await expect(getInstallation()).resolves.toBeNull();

    expect(metadataGet).toHaveBeenCalledTimes(2);
  });
});
