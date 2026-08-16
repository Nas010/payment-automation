import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { batchUpdate, get, spreadsheetGet, update } = vi.hoisted(() => ({ batchUpdate: vi.fn(), get: vi.fn(), spreadsheetGet: vi.fn(), update: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { get: spreadsheetGet, batchUpdate, values: { get, update } } } }),
}));

import { CLIENT_HEADERS, PAYMENT_HEADERS, SCHEDULE_HEADERS } from "./records";

beforeEach(() => {
  vi.resetModules();
  spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 9, title: "Clients", gridProperties: { columnCount: 27 } } }] } });
});
afterEach(() => vi.clearAllMocks());

describe("ensureClientSchema", () => {
  it("physically deletes legacy link-code columns and stale code reservations", async () => {
    const { ensureClientSchema } = await import("./migration");
    const legacyHeaders = [
      ...CLIENT_HEADERS.slice(0, 17),
      "line_link_code", "line_link_code_expires_at", "line_link_status", "line_linked_at", "line_link_message", "line_link_error",
      "line_link_token_hash", "line_link_token_encrypted", "line_link_token_expires_at", "line_picture_url",
    ];
    spreadsheetGet.mockResolvedValueOnce({ data: {
      sheets: [{ properties: { sheetId: 9, title: "Clients", gridProperties: { columnCount: 27 } } }],
      namedRanges: [{ name: `line_link_code_${"a".repeat(64)}`, namedRangeId: "legacy-code-range" }],
    } });
    get.mockResolvedValueOnce({ data: { values: [legacyHeaders] } });
    batchUpdate.mockResolvedValueOnce({});

    await ensureClientSchema();

    expect(batchUpdate).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", requestBody: { requests: [
      { deleteDimension: { range: { sheetId: 9, dimension: "COLUMNS", startIndex: 21, endIndex: 22 } } },
      { deleteDimension: { range: { sheetId: 9, dimension: "COLUMNS", startIndex: 18, endIndex: 19 } } },
      { deleteDimension: { range: { sheetId: 9, dimension: "COLUMNS", startIndex: 17, endIndex: 18 } } },
      { deleteNamedRange: { namedRangeId: "legacy-code-range" } },
    ] } });
  });

  it("writes only blank missing LIFF header cells and preserves existing header values", async () => {
    const { ensureClientSchema } = await import("./migration");
    const headers = [...CLIENT_HEADERS];
    headers[18] = "";
    get.mockResolvedValueOnce({ data: { values: [headers] } });
    update.mockResolvedValue({});

    await ensureClientSchema();

    expect(get).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", range: "Clients!A1:AA1" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Clients!S1", requestBody: { values: [["line_linked_at"]] } }));
  });

  it("does not write when every header cell already has a value", async () => {
    const { ensureClientSchema } = await import("./migration");
    get.mockResolvedValueOnce({ data: { values: [CLIENT_HEADERS] } });

    await ensureClientSchema();

    expect(update).not.toHaveBeenCalled();
  });

  it("expands a 17-column Clients grid before inspecting legacy columns", async () => {
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

    expect(batchUpdate).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", requestBody: { requests: [{ appendDimension: { sheetId: 12, dimension: "COLUMNS", length: 21 } }] } });
    expect(get).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", range: "Payments!A1:AY1" });
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

    expect(update).toHaveBeenCalledTimes(19);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AF1", requestBody: { values: [["line_retry_key"]] } }));
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AE1" }));
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AG1" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!AX1", requestBody: { values: [["line_terms_image_token"]] } }));
  });
});

describe("ensureScheduleSchema", () => {
  it("extends the legacy schedule grid and fills assignment headers", async () => {
    const { ensureScheduleSchema } = await import("./migration");
    spreadsheetGet.mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 14, title: "Installment Schedule", gridProperties: { columnCount: 18 } } }] } });
    get.mockResolvedValueOnce({ data: { values: [[...SCHEDULE_HEADERS.slice(0, 18)]] } });
    batchUpdate.mockResolvedValueOnce({});
    update.mockResolvedValue({});

    await ensureScheduleSchema();

    expect(SCHEDULE_HEADERS.slice(-3)).toEqual(["assignment_id", "assignment_kind", "lifecycle_operation_id"]);
    expect(batchUpdate).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", requestBody: { requests: [{ appendDimension: { sheetId: 14, dimension: "COLUMNS", length: 3 } }] } });
    expect(get).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", range: "Installment Schedule!A1:U1" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      range: "Installment Schedule!S1",
      requestBody: { values: [["assignment_id"]] },
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      range: "Installment Schedule!T1",
      requestBody: { values: [["assignment_kind"]] },
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      range: "Installment Schedule!U1",
      requestBody: { values: [["lifecycle_operation_id"]] },
    }));
  });
});
