import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { batchUpdate, get, spreadsheetGet, update } = vi.hoisted(() => ({ batchUpdate: vi.fn(), get: vi.fn(), spreadsheetGet: vi.fn(), update: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { get: spreadsheetGet, batchUpdate, values: { get, update } } } }),
}));

import { CLIENT_HEADERS, PAYMENT_HEADERS } from "./records";

beforeEach(() => {
  vi.resetModules();
  spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 9, title: "Clients", gridProperties: { columnCount: 26 } } }] } });
});
afterEach(() => vi.clearAllMocks());

describe("ensureClientSchema", () => {
  it("writes only blank missing header cells and preserves existing header values", async () => {
    const { ensureClientSchema } = await import("./migration");
    get.mockResolvedValueOnce({ data: { values: [[...CLIENT_HEADERS.slice(0, 17), "line_link_code", "", "legacy status"]] } });
    update.mockResolvedValue({});

    await ensureClientSchema();

    expect(get).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", range: "Clients!A1:AA1" });
    expect(update).toHaveBeenCalledTimes(8);
    expect(update).toHaveBeenNthCalledWith(1, expect.objectContaining({ range: "Clients!S1", requestBody: { values: [["line_link_code_expires_at"]] } }));
    expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({ range: "Clients!U1", requestBody: { values: [["line_linked_at"]] } }));
    expect(update).toHaveBeenNthCalledWith(3, expect.objectContaining({ range: "Clients!V1", requestBody: { values: [["line_link_message"]] } }));
    expect(update).toHaveBeenNthCalledWith(4, expect.objectContaining({ range: "Clients!W1", requestBody: { values: [["line_link_error"]] } }));
    expect(update).toHaveBeenNthCalledWith(5, expect.objectContaining({ range: "Clients!X1", requestBody: { values: [["line_link_token_hash"]] } }));
    expect(update).toHaveBeenNthCalledWith(6, expect.objectContaining({ range: "Clients!Y1", requestBody: { values: [["line_link_token_encrypted"]] } }));
    expect(update).toHaveBeenNthCalledWith(7, expect.objectContaining({ range: "Clients!Z1", requestBody: { values: [["line_link_token_expires_at"]] } }));
    expect(update).toHaveBeenNthCalledWith(8, expect.objectContaining({ range: "Clients!AA1", requestBody: { values: [["line_picture_url"]] } }));
  });

  it("does not write when every header cell already has a value", async () => {
    const { ensureClientSchema } = await import("./migration");
    get.mockResolvedValueOnce({ data: { values: [CLIENT_HEADERS] } });

    await ensureClientSchema();

    expect(update).not.toHaveBeenCalled();
  });

  it("expands legacy 17-column Clients grid before reading or writing through AA", async () => {
    const { ensureClientSchema } = await import("./migration");
    spreadsheetGet.mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 9, title: "Clients", gridProperties: { columnCount: 17 } } }] } });
    get.mockResolvedValueOnce({ data: { values: [[...CLIENT_HEADERS.slice(0, 17)]] } });
    batchUpdate.mockResolvedValueOnce({});
    update.mockResolvedValue({});

    await ensureClientSchema();

    expect(batchUpdate).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", requestBody: { requests: [{ appendDimension: { sheetId: 9, dimension: "COLUMNS", length: 10 } }] } });
    expect(batchUpdate.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder[0] ?? Infinity);
  });
});

describe("ensurePaymentSchema", () => {
  it("is available for repositories to migrate Payments before access", async () => {
    const { ensurePaymentSchema } = await import("./migration");
    expect(ensurePaymentSchema).toBeTypeOf("function");
  });

  it("expands a legacy 30-column Payments grid before reading or writing through AX", async () => {
    const { ensurePaymentSchema } = await import("./migration");
    spreadsheetGet.mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: "Payments", gridProperties: { columnCount: 30 } } }] } });
    get.mockResolvedValueOnce({ data: { values: [[...PAYMENT_HEADERS.slice(0, 30)]] } });
    batchUpdate.mockResolvedValueOnce({});
    update.mockResolvedValue({});

    await ensurePaymentSchema();

    expect(batchUpdate).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", requestBody: { requests: [{ appendDimension: { sheetId: 12, dimension: "COLUMNS", length: 20 } }] } });
    expect(get).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", range: "Payments!A1:AX1" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AE1", requestBody: { values: [["line_message_status"]] } }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AR1", requestBody: { values: [["line_reply_at"]] } }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AS1", requestBody: { values: [["package_name"]] } }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AW1", requestBody: { values: [["total_price_thb"]] } }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AX1", requestBody: { values: [["line_terms_image_token"]] } }));
    expect(batchUpdate.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder[0] ?? Infinity);
  });

  it("fills only blank appended Payments headers", async () => {
    const { ensurePaymentSchema } = await import("./migration");
    spreadsheetGet.mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: "Payments", gridProperties: { columnCount: 49 } } }] } });
    get.mockResolvedValueOnce({ data: { values: [[...PAYMENT_HEADERS.slice(0, 30), "line_message_status", "", "legacy retry key"]] } });
    update.mockResolvedValue({});

    await ensurePaymentSchema();

    expect(update).toHaveBeenCalledTimes(18);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AF1", requestBody: { values: [["line_retry_key"]] } }));
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AE1" }));
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AG1" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AX1", requestBody: { values: [["line_terms_image_token"]] } }));
  });
});
