import { afterEach, describe, expect, it, vi } from "vitest";

const { get, update } = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { values: { get, update } } } }),
}));

import { listClients, writeClient } from "./clients";

const clientHeaders = [
  "client_id", "active", "client_name", "line_user_id", "line_display_name", "package_name", "payment_type",
  "total_price_thb", "installment_count", "interval_months", "first_due_date", "default_amount_thb",
  "billing_frequency", "next_due_date", "notes", "created_at", "updated_at",
  "line_link_code", "line_link_code_expires_at", "line_link_status", "line_linked_at", "line_link_message", "line_link_error",
];

afterEach(() => vi.clearAllMocks());

describe("Clients repository", () => {
  it("writes a new client into the first blank ID row even when later columns are occupied", async () => {
    get.mockResolvedValueOnce({ data: { values: [clientHeaders] } });
    get.mockResolvedValueOnce({ data: { values: [
      ["client_id"], ["client_1"], ["", "FALSE", "retired client"], ["client_3"],
    ] } });
    update.mockResolvedValueOnce({});

    await writeClient({
      client_id: "client_2", active: "TRUE", client_name: "Nisa", line_user_id: "", line_display_name: "", package_name: "PT",
      payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10",
      default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: "now", updated_at: "now",
      line_link_code: "", line_link_code_expires_at: "", line_link_status: "", line_linked_at: "", line_link_message: "", line_link_error: "",
    });

    expect(get).toHaveBeenNthCalledWith(2, expect.objectContaining({ range: "Clients!A:W" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Clients!A3:W3" }));
  });

  it("lists clients from all 23 columns after ensuring the schema", async () => {
    get.mockResolvedValueOnce({ data: { values: [clientHeaders] } });
    get.mockResolvedValueOnce({ data: { values: [clientHeaders, ["client_1", "TRUE", "Nisa", "", "", "PT", "ONE_TIME", "1000", "1", "0", "2026-08-10", "1000", "MANUAL", "2026-08-10", "", "now", "now", "CODE", "2026-08-17", "PENDING", "", "", ""]] } });

    await expect(listClients()).resolves.toMatchObject([{ client_id: "client_1", line_link_code: "CODE", line_link_status: "PENDING" }]);
    expect(get).toHaveBeenNthCalledWith(2, expect.objectContaining({ range: "Clients!A:W" }));
  });
});
