import { afterEach, describe, expect, it, vi } from "vitest";

const { get, update } = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { values: { get, update } } } }),
}));

import { ensureClientSchema } from "./migration";
import { CLIENT_HEADERS } from "./records";

afterEach(() => vi.clearAllMocks());

describe("ensureClientSchema", () => {
  it("writes only blank missing header cells and preserves existing header values", async () => {
    get.mockResolvedValueOnce({ data: { values: [[...CLIENT_HEADERS.slice(0, 17), "line_link_code", "", "legacy status"]] } });
    update.mockResolvedValue({});

    await ensureClientSchema();

    expect(get).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", range: "Clients!A1:W1" });
    expect(update).toHaveBeenCalledTimes(4);
    expect(update).toHaveBeenNthCalledWith(1, expect.objectContaining({ range: "Clients!S1", requestBody: { values: [["line_link_code_expires_at"]] } }));
    expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({ range: "Clients!U1", requestBody: { values: [["line_linked_at"]] } }));
    expect(update).toHaveBeenNthCalledWith(3, expect.objectContaining({ range: "Clients!V1", requestBody: { values: [["line_link_message"]] } }));
    expect(update).toHaveBeenNthCalledWith(4, expect.objectContaining({ range: "Clients!W1", requestBody: { values: [["line_link_error"]] } }));
  });

  it("does not write when every header cell already has a value", async () => {
    get.mockResolvedValueOnce({ data: { values: [CLIENT_HEADERS] } });

    await ensureClientSchema();

    expect(update).not.toHaveBeenCalled();
  });
});
