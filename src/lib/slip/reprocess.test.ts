import { describe, expect, it, vi } from "vitest";
import { evaluatePayment } from "@/lib/payments/evaluate";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { SlipAnalysis } from "./analyze";
import { reprocessStoredSlipEvidence, type ReprocessSlipDependencies } from "./reprocess";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    rowNumber: 2,
    payment_id: "pay_1",
    client_id: "client_1",
    client_name: "Nisa",
    amount_thb: "3000.00",
    status: "REVIEW",
    created_at: "2026-08-10T00:00:00.000Z",
    submitted_at: "2026-08-10T04:00:00.000Z",
    recorded_at: "",
    manual_confirmed_at: "",
    slip_url: "https://drive.google.com/open?id=slip-file-12345",
    slip_hash: "old-hash",
    transaction_ref: "",
    originating_bank: "",
    ...overrides,
  } as PaymentRecord;
}

function analysis(overrides: Partial<SlipAnalysis> = {}): SlipAnalysis {
  return {
    imageHash: "new-image-hash",
    qrPayloadHash: "new-qr-hash",
    qrValid: true,
    transactionRef: "TXN-100",
    originatingBank: "014",
    ocrAmountSatang: 300000,
    ocrReceiver: "NAS O",
    ocrTransactionDate: "2026-08-10T03:00:00.000Z",
    reasons: [],
    ...overrides,
  };
}

function dependencies(overrides: Partial<ReprocessSlipDependencies> = {}): ReprocessSlipDependencies {
  const row = payment();
  return {
    getPaymentById: vi.fn(async () => row),
    listPayments: vi.fn(async () => [row]),
    readDriveSlipFile: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), declaredMimeType: "image/jpeg" })),
    analyzeSlip: vi.fn(async () => analysis()),
    evaluatePayment,
    updatePaymentIfUnchanged: vi.fn(async () => true),
    appendAudit: vi.fn(async () => undefined),
    now: vi.fn(() => "2026-08-16T04:00:00.000Z"),
    ...overrides,
  };
}

const input = { paymentId: "pay_1", receiverAliases: ["NAS O"], ocrEnabled: true };

describe("reprocessStoredSlipEvidence", () => {
  it("dry-runs an explicit retained payment without writing evidence", async () => {
    const deps = dependencies();

    const report = await reprocessStoredSlipEvidence(input, deps);

    expect(report).toEqual({
      applied: false,
      decision: "AUTO_RECORDED",
      score: 100,
      checks: {
        qrValid: true,
        transactionReferenceDetected: true,
        amountDetected: true,
        amountMatchesExpected: true,
        transactionDateDetected: true,
        receiverRecovered: true,
      },
      diagnostics: [],
    });
    expect(deps.readDriveSlipFile).toHaveBeenCalledWith("slip-file-12345");
    expect(deps.analyzeSlip).toHaveBeenCalledWith(expect.any(Uint8Array), "image/jpeg", ["NAS O"], { ocrEnabled: true });
    expect(deps.updatePaymentIfUnchanged).not.toHaveBeenCalled();
    expect(deps.appendAudit).not.toHaveBeenCalled();
  });

  it("applies passing evidence without changing historical status or timestamps", async () => {
    const row = payment({ status: "FLAGGED" });
    const deps = dependencies({ getPaymentById: vi.fn(async () => row), listPayments: vi.fn(async () => [row]) });

    const report = await reprocessStoredSlipEvidence({ ...input, applyEvidence: true }, deps);

    expect(report).toMatchObject({ applied: true, decision: "AUTO_RECORDED", score: 100 });
    expect(deps.updatePaymentIfUnchanged).toHaveBeenCalledWith({
      expectedPayment: row,
      payment: expect.objectContaining({
        status: "FLAGGED",
        submitted_at: row.submitted_at,
        recorded_at: row.recorded_at,
        manual_confirmed_at: row.manual_confirmed_at,
        slip_url: row.slip_url,
        slip_hash: "new-image-hash",
        qr_payload_hash: "new-qr-hash",
        qr_valid: "true",
        transaction_ref: "TXN-100",
        originating_bank: "014",
        ocr_amount: "3000",
        ocr_receiver: "NAS O",
        amount_match: "true",
        receiver_match: "true",
        date_match: "true",
        check_score: "100",
        review_reason: "OCR_RECHECK_PASSED; MANUAL_CONFIRMATION_REQUIRED",
      }),
    });
    expect(deps.appendAudit).toHaveBeenCalledWith({
      paymentId: "pay_1",
      clientId: "client_1",
      action: "OCR_EVIDENCE_REANALYZED",
      previousStatus: "FLAGGED",
      newStatus: "FLAGGED",
      reason: "OCR evidence refreshed; manual confirmation remains required",
      source: "ADMIN",
      metadata: JSON.stringify({ evidenceUpdated: true }),
    });
  });

  it.each([
    ["terminal payment", payment({ status: "MANUAL_CONFIRMED" }), "Only REVIEW or FLAGGED payments can be reprocessed"],
    ["missing retained file", payment({ slip_url: "" }), "Retained private slip is unavailable"],
    ["malformed retained URL", payment({ slip_url: "https://example.com/not-a-drive-file" }), "Retained private slip is unavailable"],
  ])("rejects %s before OCR", async (_label, row, message) => {
    const deps = dependencies({ getPaymentById: vi.fn(async () => row) });

    await expect(reprocessStoredSlipEvidence(input, deps)).rejects.toThrow(message);

    expect(deps.analyzeSlip).not.toHaveBeenCalled();
    expect(deps.updatePaymentIfUnchanged).not.toHaveBeenCalled();
  });

  it("reports only allowlisted diagnostics when the recheck stays in review", async () => {
    const deps = dependencies({
      analyzeSlip: vi.fn(async () => analysis({
        ocrAmountSatang: null,
        reasons: ["OCR_AMOUNT_AMBIGUOUS", "raw candidate 5900.00", "OCR_UNKNOWN_CODE"],
      })),
    });

    const report = await reprocessStoredSlipEvidence(input, deps);

    expect(report).toMatchObject({ applied: false, decision: "REVIEW", diagnostics: ["OCR_AMOUNT_AMBIGUOUS"] });
    expect(JSON.stringify(report)).not.toContain("5900.00");
  });

  it("refuses to apply evidence unless every auto-record gate passes", async () => {
    const deps = dependencies({ analyzeSlip: vi.fn(async () => analysis({ ocrAmountSatang: 299900 })) });

    await expect(reprocessStoredSlipEvidence({ ...input, applyEvidence: true }, deps)).rejects.toThrow("Evidence apply requires all checks to pass");

    expect(deps.updatePaymentIfUnchanged).not.toHaveBeenCalled();
    expect(deps.appendAudit).not.toHaveBeenCalled();
  });

  it("fails safely when the payment changes before the evidence write", async () => {
    const deps = dependencies({ updatePaymentIfUnchanged: vi.fn(async () => false) });

    await expect(reprocessStoredSlipEvidence({ ...input, applyEvidence: true }, deps)).rejects.toThrow("Payment changed before OCR evidence update");

    expect(deps.appendAudit).not.toHaveBeenCalled();
  });
});
