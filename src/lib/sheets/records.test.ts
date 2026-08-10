import { describe, expect, it } from "vitest";
import { CLIENT_HEADERS, PAYMENT_HEADERS, SCHEDULE_HEADERS, rowToRecord } from "./records";

describe("rowToRecord", () => {
  it("maps the Payments header order without relying on names", () => {
    expect(rowToRecord(PAYMENT_HEADERS, ["pay_1", "client_1", "John"])).toMatchObject({ payment_id: "pay_1", client_id: "client_1", client_name: "John", status: "" });
  });

  it("retains only a QR payload hash, never raw QR data", () => {
    expect(PAYMENT_HEADERS).toContain("qr_payload_hash");
    expect(PAYMENT_HEADERS).not.toContain("qr_payload");
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
