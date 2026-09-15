import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_HEADERS } from "./records";

const get = vi.fn();

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { values: { get } } } }),
}));

import { hasLineAuditEvent, hasPaymentTransitionAudit } from "./audit";

beforeEach(() => {
  vi.clearAllMocks();
  const record = {
    timestamp: "2026-08-10T02:00:00.000Z",
    payment_id: "pay_1",
    client_id: "client_1",
    action: "LINE_DUE_MESSAGE_ACCEPTED",
    previous_status: "SENDING",
    new_status: "ACCEPTED",
    reason: "LINE accepted due-payment request",
    source: "LINE_DUE_SENDER",
    metadata: JSON.stringify({ paymentId: "pay_1", status: "ACCEPTED", requestCode: "request_1" }),
  };
  get.mockResolvedValue({ data: { values: [AUDIT_HEADERS, AUDIT_HEADERS.map((header) => record[header as keyof typeof record] ?? "")] } });
});

describe("hasLineAuditEvent", () => {
  it("matches payment, action, and safe LINE request ID together", async () => {
    await expect(hasLineAuditEvent({ paymentId: "pay_1", action: "LINE_DUE_MESSAGE_ACCEPTED", requestId: "request_1" })).resolves.toBe(true);
    await expect(hasLineAuditEvent({ paymentId: "pay_1", action: "LINE_PAYMENT_QR_SENT", requestId: "request_1" })).resolves.toBe(false);
    await expect(hasLineAuditEvent({ paymentId: "pay_1", action: "LINE_DUE_MESSAGE_ACCEPTED", requestId: "request_2" })).resolves.toBe(false);
  });
});

describe("hasPaymentTransitionAudit", () => {
  it("matches only a terminal transition's deterministic payment, action, source, and schedule identity", async () => {
    await expect(hasPaymentTransitionAudit({ paymentId: "pay_1", action: "LINE_DUE_MESSAGE_ACCEPTED", source: "LINE_DUE_SENDER", scheduleId: "schedule_1" })).resolves.toBe(false);

    get.mockResolvedValue({ data: { values: [AUDIT_HEADERS, [
      "2026-08-10T02:00:00.000Z", "pay_1", "client_1", "AUTO_RECORDED", "PENDING", "AUTO_RECORDED", "slip", "LINE_WEBHOOK", JSON.stringify({ scheduleId: "schedule_1" }),
    ]] } });

    await expect(hasPaymentTransitionAudit({ paymentId: "pay_1", action: "AUTO_RECORDED", source: "LINE_WEBHOOK", scheduleId: "schedule_1" })).resolves.toBe(true);
    await expect(hasPaymentTransitionAudit({ paymentId: "pay_1", action: "AUTO_RECORDED", source: "LINE_WEBHOOK", scheduleId: "schedule_2" })).resolves.toBe(false);
  });
});

it("records a fresh confirmation after an undo, while deduplicating its retries", async () => {
  const confirmed = ["now", "pay_1", "client_1", "MANUAL_CONFIRMED", "REVIEW", "MANUAL_CONFIRMED", "", "ADMIN", JSON.stringify({ scheduleId: "schedule_1" })];
  const undone = ["later", "pay_1", "client_1", "MANUAL_CONFIRMATION_UNDONE"];
  const identity = { paymentId: "pay_1", action: "MANUAL_CONFIRMED", source: "ADMIN", scheduleId: "schedule_1" };
  get.mockResolvedValue({ data: { values: [AUDIT_HEADERS, confirmed, undone] } });
  await expect(hasPaymentTransitionAudit(identity)).resolves.toBe(false);
  get.mockResolvedValue({ data: { values: [AUDIT_HEADERS, confirmed, undone, confirmed] } });
  await expect(hasPaymentTransitionAudit(identity)).resolves.toBe(true);
});
