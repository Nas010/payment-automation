import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { append, batchUpdate, get, spreadsheetGet, update } = vi.hoisted(() => ({
  append: vi.fn(),
  batchUpdate: vi.fn(),
  get: vi.fn(),
  spreadsheetGet: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { get: spreadsheetGet, batchUpdate, values: { append, get, update } } } }),
}));

import { appendPayment, listPayments, paymentStateTokenName, updatePayment, type PaymentRecord } from "./payments";
import { CLIENT_HEADERS, PAYMENT_HEADERS, SCHEDULE_HEADERS, rowToRecord } from "./records";

beforeEach(() => {
  spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 10, title: "Payments", gridProperties: { columnCount: 44 } } }] } });
  get.mockResolvedValue({ data: { values: [PAYMENT_HEADERS] } });
  append.mockResolvedValue({});
  update.mockResolvedValue({});
});

afterEach(() => vi.clearAllMocks());

function paymentRecord(): PaymentRecord {
  return {
    ...rowToRecord(PAYMENT_HEADERS, PAYMENT_HEADERS.map((header) => header === "payment_id" ? "pay_1" : "")),
    rowNumber: 2,
  } as PaymentRecord;
}

describe("rowToRecord", () => {
  it("maps the Payments header order without relying on names", () => {
    expect(rowToRecord(PAYMENT_HEADERS, ["pay_1", "client_1", "John"])).toMatchObject({ payment_id: "pay_1", client_id: "client_1", client_name: "John", status: "" });
  });

  it("retains only a QR payload hash, never raw QR data", () => {
    expect(PAYMENT_HEADERS).toContain("qr_payload_hash");
    expect(PAYMENT_HEADERS).not.toContain("qr_payload");
  });

  it("appends the 14 LINE payment transport columns after the established 30-column order", () => {
    expect(PAYMENT_HEADERS).toEqual([
      "payment_id", "client_id", "client_name", "period", "amount_thb", "due_date", "public_token", "payment_url", "status", "created_at",
      "submitted_at", "recorded_at", "manual_confirmed_at", "transaction_ref", "originating_bank", "slip_hash", "qr_valid", "ocr_amount", "amount_match",
      "ocr_receiver", "receiver_match", "ocr_transaction_date", "date_match", "check_score", "review_reason", "slip_url", "admin_notes", "line_message",
      "updated_at", "qr_payload_hash", "line_message_status", "line_retry_key", "line_message_attempted_at", "line_message_sent_at", "line_request_id", "line_message_error",
      "line_payment_requested_at", "line_slip_expected", "line_slip_received_at", "line_source_message_id", "line_slip_processing_status", "line_slip_error", "line_reply_status", "line_reply_at",
    ]);
  });

  it("reads and writes all 44 Payments columns", async () => {
    const payment = paymentRecord();
    const newPayment = Object.fromEntries(PAYMENT_HEADERS.map((header) => [header, payment[header]])) as Omit<PaymentRecord, "rowNumber">;
    let paymentMetadataReads = 0;
    get.mockImplementation(async ({ range }: { range: string }) => ({ data: { values: [range === "Payments!A2:AR2" ? PAYMENT_HEADERS.map((header) => payment[header]) : PAYMENT_HEADERS] } }));
    spreadsheetGet.mockImplementation(async ({ fields }: { fields: string }) => {
      if (!fields.includes("namedRanges")) return { data: { sheets: [{ properties: { sheetId: 10, title: "Payments", gridProperties: { columnCount: 44 } } }] } };
      paymentMetadataReads += 1;
      return { data: {
        sheets: [{ properties: { sheetId: 10, title: "Payments" } }],
        namedRanges: paymentMetadataReads === 1 ? [] : [{ name: paymentStateTokenName(payment), namedRangeId: "token_1" }],
      } };
    });

    await listPayments();
    await appendPayment(newPayment);
    await updatePayment(payment);

    expect(get).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", range: "Payments!A:AR" });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!A:AR" }));
    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { requests: expect.arrayContaining([
      expect.objectContaining({ addNamedRange: expect.any(Object) }),
      expect.objectContaining({ updateCells: expect.objectContaining({ range: expect.objectContaining({ startRowIndex: 1, endRowIndex: 2, endColumnIndex: 44 }) }) }),
    ]) } }));
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps coach onboarding and LINE identifiers in the Clients schema", () => {
    expect(CLIENT_HEADERS).toEqual(expect.arrayContaining([
      "line_user_id", "package_name", "payment_type", "total_price_thb",
      "installment_count", "interval_months", "first_due_date",
    ]));
  });

  it("preserves the established client columns and appends LINE linking columns in order", () => {
    expect(CLIENT_HEADERS).toEqual([
      "client_id", "active", "client_name", "line_user_id", "line_display_name", "package_name", "payment_type",
      "total_price_thb", "installment_count", "interval_months", "first_due_date", "default_amount_thb",
      "billing_frequency", "next_due_date", "notes", "created_at", "updated_at",
      "line_link_code", "line_link_code_expires_at", "line_link_status", "line_linked_at", "line_link_message", "line_link_error",
      "line_link_token_hash", "line_link_token_encrypted", "line_link_token_expires_at",
    ]);
  });

  it("uses Apps Script Installment Schedule column order without adding a second schedule schema", () => {
    expect(SCHEDULE_HEADERS).toEqual([
      "schedule_id", "client_id", "client_name", "line_user_id", "line_display_name", "package_name", "payment_type",
      "installment_number", "installment_count", "amount_thb", "due_date", "status", "generated_at", "payment_id",
      "payment_url", "notes", "created_at", "updated_at",
    ]);
  });
});
