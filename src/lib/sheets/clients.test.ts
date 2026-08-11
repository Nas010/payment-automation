import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const { batchUpdate, get, spreadsheetGet, update } = vi.hoisted(() => ({ batchUpdate: vi.fn(), get: vi.fn(), spreadsheetGet: vi.fn(), update: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { get: spreadsheetGet, batchUpdate, values: { get, update } } } }),
}));

import type { ClientRecord } from "./clients";

let claimLineLink: typeof import("./clients").claimLineLink;
let listClients: typeof import("./clients").listClients;
let updateLineLinkClient: typeof import("./clients").updateLineLinkClient;
let writeClient: typeof import("./clients").writeClient;

const clientHeaders = [
  "client_id", "active", "client_name", "line_user_id", "line_display_name", "package_name", "payment_type",
  "total_price_thb", "installment_count", "interval_months", "first_due_date", "default_amount_thb",
  "billing_frequency", "next_due_date", "notes", "created_at", "updated_at",
  "line_link_code", "line_link_code_expires_at", "line_link_status", "line_linked_at", "line_link_message", "line_link_error",
];

function linkedClient(): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", line_display_name: "", package_name: "PT", payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10", default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: "2026-08-10T00:00:00.000Z", updated_at: "2026-08-10T12:00:00.000Z",
    line_link_code: "", line_link_code_expires_at: "", line_link_status: "LINKED", line_linked_at: "2026-08-10T12:00:00.000Z", line_link_message: "", line_link_error: "",
  };
}

beforeEach(async () => {
  vi.resetModules();
  ({ claimLineLink, listClients, updateLineLinkClient, writeClient } = await import("./clients"));
  spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 9, title: "Clients", gridProperties: { columnCount: 23 } } }] } });
});
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

  it("atomically reserves code and LINE user before writing a linked client", async () => {
    get.mockResolvedValueOnce({ data: { values: [clientHeaders] } });
    batchUpdate.mockResolvedValueOnce({});

    const current = linkedClient();
    await expect(claimLineLink({ client: current, expectedClient: current, code: "ABCDEF0123", lineUserId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })).resolves.toBe("CLAIMED");

    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: {
        requests: expect.arrayContaining([
          expect.objectContaining({ addNamedRange: expect.objectContaining({ namedRange: expect.objectContaining({ name: expect.stringMatching(/^line_link_code_[a-f0-9]{64}$/) }) }) }),
          expect.objectContaining({ addNamedRange: expect.objectContaining({ namedRange: expect.objectContaining({ name: expect.stringMatching(/^line_link_user_[a-f0-9]{64}$/) }) }) }),
          expect.objectContaining({ addNamedRange: expect.objectContaining({ namedRange: expect.objectContaining({ name: expect.stringMatching(/^line_link_state_[a-f0-9]{64}$/) }) }) }),
          expect.objectContaining({ updateCells: expect.any(Object) }),
        ]),
      },
    }));
    expect(update).not.toHaveBeenCalled();
  });

  it("re-reads a completed winner after a duplicate reservation rejects its atomic batch", async () => {
    const winner = linkedClient();
    const error = Object.assign(new Error("Named range already exists"), { response: { status: 400 } });
    get
      .mockResolvedValueOnce({ data: { values: [clientHeaders] } })
      .mockResolvedValueOnce({ data: { values: [clientHeaders, clientHeaders.map((header) => winner[header as keyof ClientRecord] ?? "")] } });
    batchUpdate.mockRejectedValueOnce(error);

    await expect(claimLineLink({ client: winner, expectedClient: winner, code: "ABCDEF0123", lineUserId: winner.line_user_id })).resolves.toBe("ALREADY_LINKED");
  });

  it("rejects a stale LINE field update when its expected-state reservation already exists", async () => {
    const current = linkedClient();
    get.mockResolvedValueOnce({ data: { values: [clientHeaders] } });
    batchUpdate.mockRejectedValueOnce(Object.assign(new Error("Named range already exists"), { response: { status: 400 } }));

    await expect(updateLineLinkClient({ expectedClient: current, client: { ...current, line_display_name: "Nisa LINE" }, releaseLineUserId: current.line_user_id } as never)).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("clears the user reservation in the same successful state-CAS batch as disconnect fields", async () => {
    const current = linkedClient();
    const reservation = `line_link_user_${createHash("sha256").update(current.line_user_id).digest("hex")}`;
    spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 9, title: "Clients" } }], namedRanges: [{ name: reservation, namedRangeId: "reservation_1" }] } });
    get.mockResolvedValueOnce({ data: { values: [clientHeaders] } });
    batchUpdate.mockResolvedValueOnce({});

    await expect(updateLineLinkClient({ expectedClient: current, client: { ...current, line_user_id: "", line_display_name: "", line_link_status: "" }, releaseLineUserId: current.line_user_id })).resolves.toBe(true);
    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { requests: expect.arrayContaining([{ deleteNamedRange: { namedRangeId: "reservation_1" } }]) } }));
  });
});
