import { describe, expect, it } from "vitest";
import { PAYMENT_HEADERS, rowToRecord } from "./records";

describe("rowToRecord", () => {
  it("maps the Payments header order without relying on names", () => {
    expect(rowToRecord(PAYMENT_HEADERS, ["pay_1", "client_1", "John"])).toMatchObject({ payment_id: "pay_1", client_id: "client_1", client_name: "John", status: "" });
  });

  it("retains only a QR payload hash, never raw QR data", () => {
    expect(PAYMENT_HEADERS).toContain("qr_payload_hash");
    expect(PAYMENT_HEADERS).not.toContain("qr_payload");
  });
});
