import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_HEADERS } from "./records";

const { batchUpdate, get, spreadsheetGet, update } = vi.hoisted(() => ({ batchUpdate: vi.fn(), get: vi.fn(), spreadsheetGet: vi.fn(), update: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { get: spreadsheetGet, batchUpdate, values: { get, update } } } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 9, title: "Clients", gridProperties: { columnCount: 23 } } }] } });
  get.mockResolvedValue({ data: { values: [CLIENT_HEADERS] } });
});

describe("schema readiness cache", () => {
  it("shares one successful client schema check across repeated callers", async () => {
    const { ensureClientSchema } = await import("./migration");

    await Promise.all([ensureClientSchema(), ensureClientSchema()]);
    await ensureClientSchema();

    expect(spreadsheetGet).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
  });

  it("retries a client schema check after a transient rejection", async () => {
    spreadsheetGet
      .mockRejectedValueOnce(Object.assign(new Error("quota"), { response: { status: 429 } }))
      .mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 9, title: "Clients", gridProperties: { columnCount: 23 } } }] } });
    const { ensureClientSchema } = await import("./migration");

    await expect(ensureClientSchema()).rejects.toThrow("quota");
    await expect(ensureClientSchema()).resolves.toBeUndefined();

    expect(spreadsheetGet).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledOnce();
  });
});
