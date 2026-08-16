import { describe, expect, it, vi } from "vitest";
import { evaluatePayment } from "@/lib/payments/evaluate";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";
import type { SlipAnalysis } from "./analyze";
import { processSlipImage, type SlipProcessDependencies } from "./process";

const now = "2026-08-10T12:00:00.000Z";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    rowNumber: 2,
    payment_id: "pay_1",
    client_id: "client_1",
    client_name: "Nisa",
    amount_thb: "3000.00",
    due_date: "2026-08-10",
    status: "PENDING",
    created_at: "2026-08-10T00:00:00.000Z",
    slip_hash: "",
    transaction_ref: "",
    originating_bank: "",
    line_slip_expected: "TRUE",
    ...overrides,
  } as PaymentRecord;
}

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return { rowNumber: 2, schedule_id: "schedule_1", payment_id: "pay_1", status: "GENERATED", ...overrides } as ScheduleRecord;
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
  };
}

function dependencies(overrides: Partial<SlipProcessDependencies> = {}): SlipProcessDependencies {
  return {
    analyzeSlip: vi.fn(async () => analysis()),
    listPayments: vi.fn(async () => [payment()]),
    listSchedules: vi.fn(async () => [schedule()]),
    evaluatePayment,
    persistPaymentTransition: vi.fn(async () => ({ paymentStatus: "AUTO_RECORDED", scheduleStatus: "PAID" })),
    shouldRetainSlip: vi.fn(() => false),
    storeExceptionSlip: vi.fn(async () => "stored-url"),
    receiverAliases: ["NAS O"],
    now: vi.fn(() => now),
    ...overrides,
  };
}

describe("processSlipImage", () => {
  it("auto-records a strong match and persists extracted fields", async () => {
    const deps = dependencies();

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: payment(), source: { type: "WEB_UPLOAD" }, analysis: analysis() }, deps);

    expect(result).toMatchObject({ decision: "AUTO_RECORDED", duplicate: false, payment: { status: "AUTO_RECORDED", slip_hash: "image-hash", transaction_ref: "TXN-100", ocr_amount: "3000", amount_match: "true" } });
    expect(deps.persistPaymentTransition).toHaveBeenCalledWith(expect.objectContaining({ nextStatus: "AUTO_RECORDED", source: "CLIENT_UPLOAD" }));
    expect(deps.storeExceptionSlip).not.toHaveBeenCalled();
  });

  it("auto-records a recovered configured Thai alias with the same aliases used for OCR and evaluation", async () => {
    const recoveredAlias = "นางสาว พีรพร บุญสนิท";
    const deps = dependencies({
      receiverAliases: ["OTHER RECEIVER"],
      analyzeSlip: vi.fn(async () => analysis({ ocrReceiver: recoveredAlias })),
    });

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: payment(), source: { type: "WEB_UPLOAD" }, receiverAliases: [recoveredAlias] }, deps);

    expect(deps.analyzeSlip).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png", [recoveredAlias]);
    expect(result.decision).toBe("AUTO_RECORDED");
  });

  it("keeps an ambiguous recipient recovery in review", async () => {
    const deps = dependencies();

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: payment(), source: { type: "WEB_UPLOAD" }, analysis: analysis({ ocrReceiver: null }) }, deps);

    expect(result).toMatchObject({ decision: "REVIEW", evaluation: { reasons: expect.arrayContaining(["Recipient match uncertain"]) } });
  });

  it("uses fresh terminal payment state without overwriting it", async () => {
    const stale = payment();
    const fresh = payment({ status: "AUTO_RECORDED", line_slip_expected: "FALSE", slip_hash: "already-recorded" });
    const deps = dependencies({ listPayments: vi.fn(async () => [fresh]) });

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: stale, source: { type: "WEB_UPLOAD" } }, deps);

    expect(result).toMatchObject({ decision: "AUTO_RECORDED", duplicate: true, payment: fresh });
    expect(deps.analyzeSlip).not.toHaveBeenCalled();
    expect(deps.persistPaymentTransition).not.toHaveBeenCalled();
  });

  it("rechecks payment after analysis so a manual confirmation wins the race", async () => {
    const pending = payment();
    const confirmed = payment({ status: "MANUAL_CONFIRMED", line_slip_expected: "FALSE" });
    const deps = dependencies({ listPayments: vi.fn().mockResolvedValueOnce([pending]).mockResolvedValueOnce([confirmed]) });

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: pending, source: { type: "WEB_UPLOAD" } }, deps);

    expect(result).toMatchObject({ decision: "MANUAL_CONFIRMED", duplicate: true, payment: confirmed });
    expect(deps.listPayments).toHaveBeenCalledTimes(2);
    expect(deps.persistPaymentTransition).not.toHaveBeenCalled();
  });

  it("flags a wrong amount or receiver and stores only exception evidence", async () => {
    const deps = dependencies({ shouldRetainSlip: vi.fn(() => true) });

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: payment(), source: { type: "WEB_UPLOAD" }, analysis: analysis({ ocrAmountSatang: 299900, ocrReceiver: "OTHER" }) }, deps);

    expect(result).toMatchObject({ decision: "FLAGGED", payment: { slip_url: "stored-url", amount_match: "false", receiver_match: "false" } });
    expect(deps.storeExceptionSlip).toHaveBeenCalledOnce();
  });

  it("keeps QR or reference uncertainty in review", async () => {
    const deps = dependencies();

    await expect(processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: payment(), source: { type: "WEB_UPLOAD" }, analysis: analysis({ qrValid: false, transactionRef: null }) }, deps)).resolves.toMatchObject({ decision: "REVIEW" });
  });

  it.each([
    ["image", payment({ slip_hash: "image-hash" })],
    ["transaction reference", payment({ transaction_ref: "TXN-100", originating_bank: "014" })],
  ])("does not transition same-payment duplicate %s", async (_kind, existing) => {
    const deps = dependencies({ listPayments: vi.fn(async () => [existing]) });

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: existing, source: { type: "WEB_UPLOAD" }, analysis: analysis() }, deps);

    expect(result).toMatchObject({ duplicate: true, payment: existing });
    expect(deps.persistPaymentTransition).not.toHaveBeenCalled();
  });

  it("flags a transaction reference allocated to another payment", async () => {
    const other = payment({ payment_id: "pay_2", transaction_ref: "TXN-100", originating_bank: "014" });
    const deps = dependencies({ listPayments: vi.fn(async () => [payment(), other]) });

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: payment(), source: { type: "WEB_UPLOAD" }, analysis: analysis() }, deps);

    expect(result).toMatchObject({ decision: "FLAGGED", evaluation: { reasons: expect.arrayContaining(["Transaction reference is already allocated to another payment"]) } });
  });

  it("flags an image hash allocated to another payment", async () => {
    const other = payment({ payment_id: "pay_2", slip_hash: "image-hash" });
    const deps = dependencies({ listPayments: vi.fn(async () => [payment(), other]) });

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: payment(), source: { type: "WEB_UPLOAD" }, analysis: analysis() }, deps);

    expect(result).toMatchObject({ decision: "FLAGGED", evaluation: { reasons: expect.arrayContaining(["Exact slip image is already allocated to another payment"]) } });
  });

  it("does not analyze or persist a replayed LINE message", async () => {
    const replay = payment({ line_source_message_id: "message_1" });
    const deps = dependencies({ listPayments: vi.fn(async () => [replay]) });

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: payment(), source: { type: "LINE", lineUserId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", lineMessageId: "message_1", clientId: "client_1" } }, deps);

    expect(result).toMatchObject({ duplicate: true, payment: replay, analysis: null });
    expect(deps.analyzeSlip).not.toHaveBeenCalled();
    expect(deps.storeExceptionSlip).not.toHaveBeenCalled();
    expect(deps.persistPaymentTransition).not.toHaveBeenCalled();
  });

  it("does not persist a LINE message replayed while analysis is running", async () => {
    const pending = payment();
    const replay = payment({ line_source_message_id: "message_1" });
    const deps = dependencies({ listPayments: vi.fn().mockResolvedValueOnce([pending]).mockResolvedValueOnce([replay]) });

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: pending, source: { type: "LINE", lineUserId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", lineMessageId: "message_1", clientId: "client_1" } }, deps);

    expect(result).toMatchObject({ duplicate: true, payment: replay });
    expect(deps.listPayments).toHaveBeenCalledTimes(2);
    expect(deps.persistPaymentTransition).not.toHaveBeenCalled();
  });

  it.each([
    ["image", payment({ slip_hash: "image-hash" })],
    ["transaction reference", payment({ transaction_ref: "TXN-100", originating_bank: "014" })],
  ])("does not persist same-payment %s added while analysis is running", async (_kind, duplicate) => {
    const pending = payment();
    const deps = dependencies({ listPayments: vi.fn().mockResolvedValueOnce([pending]).mockResolvedValueOnce([duplicate]) });

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: pending, source: { type: "WEB_UPLOAD" } }, deps);

    expect(result).toMatchObject({ decision: "PENDING", duplicate: true, payment: duplicate });
    expect(deps.listPayments).toHaveBeenCalledTimes(2);
    expect(deps.persistPaymentTransition).not.toHaveBeenCalled();
  });

  it("rejects LINE source whose selected client differs from payment client", async () => {
    const deps = dependencies();

    await expect(processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: payment(), source: { type: "LINE", lineUserId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", lineMessageId: "message_1", clientId: "client_other" }, analysis: analysis() }, deps)).rejects.toThrow("LINE payment client association does not match");
    expect(deps.persistPaymentTransition).not.toHaveBeenCalled();
  });

  it("clears expected LINE slip after terminal processing", async () => {
    const deps = dependencies();

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: payment(), source: { type: "LINE", lineUserId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", lineMessageId: "message_1", clientId: "client_1" }, analysis: analysis() }, deps);

    expect(result.payment.line_slip_expected).toBe("FALSE");
    expect(deps.persistPaymentTransition).toHaveBeenCalledWith(expect.objectContaining({ source: "LINE_WEBHOOK", paymentUpdate: expect.objectContaining({ line_source_message_id: "message_1", line_slip_expected: "FALSE" }) }));
  });

  it("clears stale private evidence URL when retaining a new review slip fails", async () => {
    const deps = dependencies({
      shouldRetainSlip: vi.fn(() => true),
      storeExceptionSlip: vi.fn(async () => { throw new Error("storage unavailable"); }),
    });

    const result = await processSlipImage({ bytes: new Uint8Array([1]), declaredType: "image/png", expectedPayment: payment({ slip_url: "old-private-slip" }), source: { type: "WEB_UPLOAD" }, analysis: analysis({ qrValid: false, transactionRef: null }) }, deps);

    expect(result).toMatchObject({ decision: "REVIEW", payment: { slip_hash: "image-hash", slip_url: "" } });
    expect(deps.persistPaymentTransition).toHaveBeenCalledWith(expect.objectContaining({ paymentUpdate: expect.objectContaining({ slip_url: "" }) }));
  });
});
