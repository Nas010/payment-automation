import { describe, expect, it, vi } from "vitest";
import { PAYMENT_HEADERS } from "@/lib/sheets/records";
import type { PaymentRecord } from "@/lib/sheets/payments";
import {
  deliverDueInitialPaymentsAfterLineConnection,
  selectDueInitialPaymentsAfterLineConnection,
} from "./post-connection-delivery";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  const blank = Object.fromEntries(PAYMENT_HEADERS.map((header) => [header, ""])) as Record<(typeof PAYMENT_HEADERS)[number], string>;
  return {
    ...blank,
    rowNumber: 2,
    payment_id: "pay_due",
    client_id: "client_1",
    amount_thb: "1500",
    due_date: "2026-08-15",
    public_token: "payment-token",
    payment_url: "https://pay.example/p/payment-token",
    status: "PENDING",
    created_at: "2026-08-01T00:00:00.000Z",
    payment_type: "ONE_TIME",
    installment_number: "1",
    installment_count: "1",
    ...overrides,
  };
}

function dependencies(rows: PaymentRecord[] = [payment()]) {
  return {
    baseUrl: "https://pay.example",
    listPayments: vi.fn(async () => rows),
    appendAudit: vi.fn(async () => undefined),
    sendDueLinePaymentRequests: vi.fn(async () => ({ accepted: ["pay_due"], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false })),
  };
}

describe("selectDueInitialPaymentsAfterLineConnection", () => {
  it("selects this client's due and overdue initial payments in deterministic creation order", () => {
    const rows = [
      payment({ payment_id: "same-time-b", created_at: "2026-08-02T00:00:00.000Z" }),
      payment({ payment_id: "initial-installment", payment_type: "INSTALLMENTS", installment_number: "1", installment_count: "3", due_date: "2026-08-14", created_at: "2026-08-03T00:00:00.000Z" }),
      payment({ payment_id: "same-time-a", created_at: "2026-08-02T00:00:00.000Z" }),
      payment({ payment_id: "older-one-time", due_date: "2026-08-14", created_at: "2026-08-01T00:00:00.000Z" }),
    ];

    expect(selectDueInitialPaymentsAfterLineConnection(rows, { clientId: "client_1", today: "2026-08-15" }))
      .toEqual(["older-one-time", "same-time-a", "same-time-b", "initial-installment"]);
  });

  it("excludes rows outside this trigger's safe eligibility boundary", () => {
    const rows = [
      payment({ payment_id: "other-client", client_id: "client_2" }),
      payment({ payment_id: "future", due_date: "2026-08-16" }),
      payment({ payment_id: "later-installment", payment_type: "INSTALLMENTS", installment_number: "2", installment_count: "3" }),
      payment({ payment_id: "paid", status: "MANUAL_CONFIRMED" }),
      payment({ payment_id: "accepted", line_message_status: "ACCEPTED" }),
      payment({ payment_id: "review", line_message_status: "REVIEW" }),
      payment({ payment_id: "failed", line_message_status: "FAILED" }),
      payment({ payment_id: "invalid-token", public_token: "" }),
      payment({ payment_id: "invalid-url", payment_url: "http://pay.example/p/payment-token" }),
      payment({ payment_id: "invalid-amount", amount_thb: "0" }),
      payment({ payment_id: "invalid-date", due_date: "2026-02-30" }),
    ];

    expect(selectDueInitialPaymentsAfterLineConnection(rows, { clientId: "client_1", today: "2026-08-15" })).toEqual([]);
  });
});

describe("deliverDueInitialPaymentsAfterLineConnection", () => {
  it("delegates only selected IDs to the existing due-payment sender", async () => {
    const deps = dependencies([
      payment({ payment_id: "overdue", due_date: "2026-08-14" }),
      payment({ payment_id: "future", due_date: "2026-08-16" }),
    ]);

    await expect(deliverDueInitialPaymentsAfterLineConnection({ clientId: "client_1", today: "2026-08-15" }, deps))
      .resolves.toMatchObject({ paymentIds: ["overdue"], selectionFailed: false });
    expect(deps.sendDueLinePaymentRequests).toHaveBeenCalledWith({
      baseUrl: "https://pay.example",
      today: "2026-08-15",
      paymentIds: ["overdue"],
    });
  });

  it("returns a no-op without invoking the sender when no payment is eligible", async () => {
    const deps = dependencies([payment({ due_date: "2026-08-16" })]);

    await expect(deliverDueInitialPaymentsAfterLineConnection({ clientId: "client_1", today: "2026-08-15" }, deps))
      .resolves.toEqual({ paymentIds: [], selectionFailed: false, delivery: null });
    expect(deps.sendDueLinePaymentRequests).not.toHaveBeenCalled();
  });

  it("records a safe client-level audit and returns selection failure when payment reading fails", async () => {
    const deps = dependencies();
    deps.listPayments.mockRejectedValue(new Error("sheets unavailable"));

    await expect(deliverDueInitialPaymentsAfterLineConnection({ clientId: "client_1", today: "2026-08-15" }, deps))
      .resolves.toEqual({ paymentIds: [], selectionFailed: true, delivery: null });
    expect(deps.appendAudit).toHaveBeenCalledWith({
      paymentId: "",
      clientId: "client_1",
      action: "LINE_POST_CONNECT_DELIVERY_SELECTION_FAILED",
      previousStatus: "",
      newStatus: "FAILED_RETRYABLE",
      reason: "Post-connection payment selection failed",
      source: "LINE_CONNECT",
      metadata: JSON.stringify({ clientId: "client_1", reasonCode: "PAYMENT_SELECTION_FAILED" }),
    });
    expect(JSON.stringify(deps.appendAudit.mock.calls)).not.toContain("sheets unavailable");
    expect(deps.sendDueLinePaymentRequests).not.toHaveBeenCalled();
  });
});
