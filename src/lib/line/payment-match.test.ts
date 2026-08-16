import { describe, expect, it } from "vitest";
import type { SlipAnalysis } from "@/lib/slip/analyze";
import type { PaymentRecord } from "@/lib/sheets/payments";
import { resolveLinePaymentCandidate } from "./payment-match";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    payment_id: "pay_1",
    client_id: "client_1",
    amount_thb: "3000.00",
    due_date: "2026-08-10",
    status: "PENDING",
    ...overrides,
  } as PaymentRecord;
}

function analysis(overrides: Partial<SlipAnalysis> = {}): SlipAnalysis {
  return {
    imageHash: "image-hash",
    qrPayloadHash: "qr-hash",
    qrValid: true,
    transactionRef: "TXN-100",
    originatingBank: "014",
    ocrAmountSatang: 300000,
    ocrReceiver: "NAS O",
    ocrTransactionDate: "2026-08-10T03:00:00.000Z",
    reasons: [],
    ...overrides,
    recipientProxyMatch: overrides.recipientProxyMatch ?? true,
    transferStatus: overrides.transferStatus ?? "SUCCESS",
  };
}

describe("resolveLinePaymentCandidate", () => {
  it("returns only eligible payment without using slip signals", () => {
    const only = payment();

    expect(resolveLinePaymentCandidate([only], analysis({ ocrAmountSatang: null, ocrTransactionDate: null }))).toBe(only);
  });

  it("selects unique exact satang amount before date proximity", () => {
    const match = payment({ payment_id: "amount-match", amount_thb: "3000.00", due_date: "2026-09-01" });
    const dateMatch = payment({ payment_id: "date-match", amount_thb: "2500.00", due_date: "2026-08-10" });

    expect(resolveLinePaymentCandidate([match, dateMatch], analysis())).toBe(match);
  });

  it("selects closest plausible due date when exact amount leaves multiple candidates", () => {
    const closest = payment({ payment_id: "closest", due_date: "2026-08-10" });
    const later = payment({ payment_id: "later", due_date: "2026-08-13" });

    expect(resolveLinePaymentCandidate([closest, later], analysis())).toBe(closest);
  });

  it("returns null when closest plausible due-date candidates tie", () => {
    const first = payment({ payment_id: "first", due_date: "2026-08-10" });
    const second = payment({ payment_id: "second", due_date: "2026-08-10" });

    expect(resolveLinePaymentCandidate([first, second], analysis())).toBeNull();
  });
});
