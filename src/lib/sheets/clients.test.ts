import { describe, expect, it, vi } from "vitest";

const { get, update } = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { values: { get, update } } } }),
}));

import { writeClient } from "./clients";

describe("Clients repository", () => {
  it("writes a new client into the first blank ID row even when later columns are occupied", async () => {
    get.mockResolvedValueOnce({ data: { values: [
      ["client_id"], ["client_1"], ["", "FALSE", "retired client"], ["client_3"],
    ] } });
    update.mockResolvedValueOnce({});

    await writeClient({
      client_id: "client_2", active: "TRUE", client_name: "Nisa", line_user_id: "", line_display_name: "", package_name: "PT",
      payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10",
      default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: "now", updated_at: "now",
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Clients!A3:Q3" }));
  });
});
