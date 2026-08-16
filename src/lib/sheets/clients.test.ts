import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const { batchUpdate, get, spreadsheetGet, update } = vi.hoisted(() => ({ batchUpdate: vi.fn(), get: vi.fn(), spreadsheetGet: vi.fn(), update: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { get: spreadsheetGet, batchUpdate, values: { get, update } } } }),
}));

import type { ClientRecord } from "./clients";

let claimLineConnection: typeof import("./clients").claimLineConnection;
let listClients: typeof import("./clients").listClients;
let updateLineLinkClient: typeof import("./clients").updateLineLinkClient;
let writeClient: typeof import("./clients").writeClient;

const clientHeaders = [
  "client_id", "active", "client_name", "line_user_id", "line_display_name", "package_name", "payment_type",
  "total_price_thb", "installment_count", "interval_months", "first_due_date", "default_amount_thb",
  "billing_frequency", "next_due_date", "notes", "created_at", "updated_at",
  "line_link_status", "line_linked_at", "line_link_error",
  "line_link_token_hash", "line_link_token_encrypted", "line_link_token_expires_at", "line_picture_url",
];

function linkedClient(): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", line_display_name: "", line_picture_url: "", package_name: "PT", payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10", default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: "2026-08-10T00:00:00.000Z", updated_at: "2026-08-10T12:00:00.000Z",
    line_link_status: "LINKED", line_linked_at: "2026-08-10T12:00:00.000Z", line_link_error: "",
    line_link_token_hash: "a".repeat(64), line_link_token_encrypted: "", line_link_token_expires_at: "",
  };
}

beforeEach(async () => {
  vi.resetModules();
  ({ claimLineConnection, listClients, updateLineLinkClient, writeClient } = await import("./clients"));
  spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 9, title: "Clients", gridProperties: { columnCount: 27 } } }] } });
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
      client_id: "client_2", active: "TRUE", client_name: "Nisa", line_user_id: "", line_display_name: "", line_picture_url: "", package_name: "PT",
      payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10",
      default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: "now", updated_at: "now",
      line_link_status: "", line_linked_at: "", line_link_error: "",
      line_link_token_hash: "", line_link_token_encrypted: "", line_link_token_expires_at: "",
    });

    expect(get).toHaveBeenNthCalledWith(2, expect.objectContaining({ range: "Clients!A:X" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Clients!A3:X3" }));
  });

  it("lists clients from all 24 LIFF-only columns after ensuring schema", async () => {
    get.mockResolvedValueOnce({ data: { values: [clientHeaders] } });
    get.mockResolvedValueOnce({ data: { values: [clientHeaders, ["client_1", "TRUE", "Nisa", "", "", "PT", "ONE_TIME", "1000", "1", "0", "2026-08-10", "1000", "MANUAL", "2026-08-10", "", "now", "now", "PENDING", "", ""]] } });

    await expect(listClients()).resolves.toMatchObject([{ client_id: "client_1", line_link_status: "PENDING" }]);
    expect(get).toHaveBeenNthCalledWith(2, expect.objectContaining({ range: "Clients!A:X" }));
  });

  it("atomically reserves token hash and LINE user before consuming a connection", async () => {
    get.mockResolvedValueOnce({ data: { values: [clientHeaders] } });
    batchUpdate.mockResolvedValueOnce({});
    const pictureUrl = "https://profile.line-scdn.net/avatar/path";
    const current = { ...linkedClient(), line_picture_url: pictureUrl } as ClientRecord;

    await expect(claimLineConnection({
      client: current,
      expectedClient: current,
      tokenHash: "b".repeat(64),
      lineUserId: current.line_user_id,
    })).resolves.toBe("CLAIMED");

    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { requests: expect.arrayContaining([
      expect.objectContaining({ addNamedRange: expect.objectContaining({ namedRange: expect.objectContaining({ name: expect.stringMatching(/^line_link_token_[a-f0-9]{64}$/) }) }) }),
      expect.objectContaining({ addNamedRange: expect.objectContaining({ namedRange: expect.objectContaining({ name: expect.stringMatching(/^line_link_user_[a-f0-9]{64}$/) }) }) }),
      expect.objectContaining({ updateCells: expect.objectContaining({ range: expect.objectContaining({ startColumnIndex: 16, endColumnIndex: 23 }) }) }),
      expect.objectContaining({ updateCells: expect.objectContaining({ range: expect.objectContaining({ startColumnIndex: 23, endColumnIndex: 24 }), rows: [{ values: [{ userEnteredValue: { stringValue: pictureUrl } }] }] }) }),
    ]) } }));
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
