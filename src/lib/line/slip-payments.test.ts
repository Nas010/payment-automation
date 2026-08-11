import { describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { SlipAnalysis } from "@/lib/slip/analyze";
import { processLineSlipEvent, type LineSlipDependencies } from "./slip-payments";

const now = "2026-08-11T12:00:00.000Z";
const lineUserId = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return { rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: lineUserId, line_link_status: "LINKED", ...overrides } as ClientRecord;
}

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return { rowNumber: 2, payment_id: "pay_1", client_id: "client_1", amount_thb: "3000", due_date: "2026-08-11", status: "PENDING", line_slip_expected: "TRUE", line_slip_processing_status: "AWAITING", line_source_message_id: "", line_reply_status: "", line_reply_at: "", line_slip_error: "", updated_at: "2026-08-10T00:00:00.000Z", created_at: "2026-08-11T00:00:00.000Z", ...overrides } as PaymentRecord;
}

function analysis(overrides: Partial<SlipAnalysis> = {}): SlipAnalysis {
  return { imageHash: "image-hash", qrPayloadHash: "qr-hash", qrValid: true, transactionRef: "TXN-100", originatingBank: "014", ocrAmountSatang: 300000, ocrReceiver: "NAS O", ocrTransactionDate: "2026-08-11T04:00:00.000Z", reasons: [], ...overrides };
}

function dependencies(overrides: Partial<LineSlipDependencies> = {}, initialPayments: PaymentRecord[] = [payment()]): LineSlipDependencies {
  let records = initialPayments;
  return {
    listClients: vi.fn(async () => [client()]),
    listPayments: vi.fn(async () => records),
    listSchedules: vi.fn(async () => records.map((row, index) => ({ rowNumber: index + 2, schedule_id: `schedule_${index + 1}`, payment_id: row.payment_id, status: "GENERATED" } as const))),
    updatePayment: vi.fn(async (next) => { records = records.map((row) => row.payment_id === next.payment_id ? next : row); }),
    updatePaymentIfUnchanged: vi.fn(async ({ payment: next }) => { records = records.map((row) => row.payment_id === next.payment_id ? next : row); return true; }),
    appendAudit: vi.fn(async () => undefined),
    persistPaymentTransition: vi.fn(async ({ paymentUpdate }) => { records = records.map((row) => row.payment_id === paymentUpdate.payment_id ? paymentUpdate : row); return { paymentStatus: "REVIEW", scheduleStatus: "GENERATED" }; }),
    getLineChannelAccessToken: vi.fn(async () => "access-token-which-is-never-logged"),
    getLineMessageContent: vi.fn(async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" as const })),
    hashSlipImage: vi.fn(() => "image-hash"),
    analyzeSlip: vi.fn(async () => analysis()),
    resolveLinePaymentCandidate: vi.fn((payments) => payments.length === 1 ? payments[0] ?? null : null),
    processSlipImage: vi.fn(async ({ expectedPayment }) => {
      const next = { ...expectedPayment, status: "AUTO_RECORDED" as const, line_slip_expected: "FALSE", line_source_message_id: "message_1", updated_at: now };
      records = records.map((row) => row.payment_id === next.payment_id ? next : row);
      return { decision: "AUTO_RECORDED" as const, duplicate: false, analysis: analysis(), evaluation: null, payment: next };
    }),
    replyLineMessage: vi.fn(async () => undefined),
    lineChatPaymentsEnabled: vi.fn(() => true),
    receiverAliases: vi.fn(() => ["NAS O", "NAS OFFICE"]),
    reconcileTerminalPaymentEffects: vi.fn(async () => undefined),
    now: vi.fn(() => now),
    ...overrides,
  };
}

const event = { webhookEventId: "event_1", replyToken: "reply-token", lineUserId, messageId: "message_1" };

describe("processLineSlipEvent", () => {
  it("does no downstream work when LINE chat payments are disabled", async () => {
    const deps = dependencies({ lineChatPaymentsEnabled: vi.fn(() => false) } as Partial<LineSlipDependencies>);

    await expect(processLineSlipEvent(event, deps)).resolves.toEqual({ kind: "ignored" });
    expect(deps.listClients).not.toHaveBeenCalled();
    expect(deps.listPayments).not.toHaveBeenCalled();
    expect(deps.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(deps.getLineMessageContent).not.toHaveBeenCalled();
    expect(deps.analyzeSlip).not.toHaveBeenCalled();
    expect(deps.persistPaymentTransition).not.toHaveBeenCalled();
    expect(deps.appendAudit).not.toHaveBeenCalled();
    expect(deps.replyLineMessage).not.toHaveBeenCalled();
  });

  it("ignores an unlinked image before resolving credentials, downloading content, or analyzing", async () => {
    const deps = dependencies({ listClients: vi.fn(async () => []) });

    await expect(processLineSlipEvent(event, deps)).resolves.toEqual({ kind: "ignored" });
    expect(deps.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(deps.getLineMessageContent).not.toHaveBeenCalled();
    expect(deps.analyzeSlip).not.toHaveBeenCalled();
    expect(deps.replyLineMessage).not.toHaveBeenCalled();
  });

  it("ignores a linked image when no pending LINE slip is awaiting", async () => {
    const deps = dependencies({ listPayments: vi.fn(async () => [payment({ line_slip_expected: "FALSE" })]) });

    await expect(processLineSlipEvent(event, deps)).resolves.toEqual({ kind: "ignored" });
    expect(deps.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(deps.getLineMessageContent).not.toHaveBeenCalled();
    expect(deps.analyzeSlip).not.toHaveBeenCalled();
  });

  it.each(["DOWNLOADING", "ANALYZING"]) ("ignores an in-flight %s payment before credential or content work", async (processingStatus) => {
    const deps = dependencies({ listPayments: vi.fn(async () => [payment({ line_slip_processing_status: processingStatus })]) });

    await expect(processLineSlipEvent(event, deps)).resolves.toEqual({ kind: "ignored" });
    expect(deps.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(deps.getLineMessageContent).not.toHaveBeenCalled();
  });

  it("retries a new image for a transiently failed payment", async () => {
    const failed = payment({ line_slip_processing_status: "FAILED_TRANSIENT", line_slip_error: "LINE content download failed" });
    const deps = dependencies({}, [failed]);

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "processed", decision: "AUTO_RECORDED" });
    expect(deps.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({
      expectedPayment: expect.objectContaining({ line_slip_processing_status: "FAILED_TRANSIENT" }),
      payment: expect.objectContaining({ line_slip_processing_status: "DOWNLOADING", line_slip_error: "" }),
    }));
    expect(deps.getLineMessageContent).toHaveBeenCalledOnce();
  });

  it("exits a redelivered message before downloading content", async () => {
    const existing = payment({ line_source_message_id: "message_1", line_slip_processing_status: "AUTO_RECORDED", status: "AUTO_RECORDED" });
    const deps = dependencies({ listPayments: vi.fn(async () => [existing]) });

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "duplicate", payment: existing });
    expect(deps.getLineChannelAccessToken).toHaveBeenCalledOnce();
    expect(deps.getLineMessageContent).not.toHaveBeenCalled();
    expect(deps.reconcileTerminalPaymentEffects).toHaveBeenCalledOnce();
  });

  it("marks progress, analyzes once, processes the selected payment, replies, and persists reply state", async () => {
    const stored = payment();
    const deps = dependencies({}, [stored]);

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "processed", decision: "AUTO_RECORDED", payment: expect.objectContaining({ payment_id: "pay_1" }) });
    expect(deps.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ line_slip_processing_status: "DOWNLOADING", line_slip_error: "" }) }));
    expect(deps.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ line_slip_processing_status: "ANALYZING" }) }));
    expect(deps.analyzeSlip).toHaveBeenCalledOnce();
    expect(deps.processSlipImage).toHaveBeenCalledWith(expect.objectContaining({ expectedPayment: stored, analysis: analysis(), source: { type: "LINE", lineUserId, lineMessageId: "message_1", clientId: "client_1" } }));
    expect(deps.replyLineMessage).toHaveBeenCalledWith(expect.objectContaining({ replyToken: "reply-token", text: "Payment slip received and recorded." }));
    expect(deps.updatePaymentIfUnchanged).toHaveBeenLastCalledWith(expect.objectContaining({ payment: expect.objectContaining({ payment_id: "pay_1", line_reply_status: "SENT", line_reply_at: now }) }));
  });

  it("passes configured receiver aliases into pre-analysis without exposing them elsewhere", async () => {
    const deps = dependencies({ receiverAliases: vi.fn(() => ["NAS O", "NAS OFFICE"]) } as Partial<LineSlipDependencies>);

    await processLineSlipEvent(event, deps);

    expect(deps.analyzeSlip).toHaveBeenCalledWith(expect.any(Uint8Array), "image/jpeg", ["NAS O", "NAS OFFICE"]);
    expect(deps.appendAudit.mock.calls.flat().join(" ")).not.toContain("NAS OFFICE");
  });

  it("reconciles terminal transition effects before replying to a redelivered LINE message", async () => {
    const recorded = payment({ status: "AUTO_RECORDED", line_slip_expected: "FALSE", line_source_message_id: "message_1", line_slip_processing_status: "AUTO_RECORDED" });
    const calls: string[] = [];
    const deps = dependencies({
      listPayments: vi.fn(async () => [recorded]),
      reconcileTerminalPaymentEffects: vi.fn(async () => { calls.push("reconcile"); }),
      getLineChannelAccessToken: vi.fn(async () => { calls.push("token"); return "access-token-which-is-never-logged"; }),
      replyLineMessage: vi.fn(async () => { calls.push("reply"); }),
    } as Partial<LineSlipDependencies>);

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "duplicate", payment: recorded });
    expect(calls).toEqual(["reconcile", "token", "reply"]);
    expect(deps.listSchedules).toHaveBeenCalledOnce();
    expect(deps.getLineMessageContent).not.toHaveBeenCalled();
  });

  it.each(["SENT", "SENDING"]) ("reconciles a terminal %s redelivery without sending another reply", async (replyStatus) => {
    const recorded = payment({ status: "AUTO_RECORDED", line_slip_expected: "FALSE", line_source_message_id: "message_1", line_slip_processing_status: "AUTO_RECORDED", line_reply_status: replyStatus });
    const deps = dependencies({ listPayments: vi.fn(async () => [recorded]) });

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "duplicate", payment: recorded });
    expect(deps.reconcileTerminalPaymentEffects).toHaveBeenCalledOnce();
    expect(deps.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(deps.replyLineMessage).not.toHaveBeenCalled();
  });

  it("does no reply work when another reconciler holds a live terminal-effects lease", async () => {
    const recorded = payment({ status: "AUTO_RECORDED", line_slip_expected: "FALSE", line_source_message_id: "message_1", line_slip_processing_status: "AUTO_RECORDED", line_slip_error: "TRANSITION_EFFECTS_CLAIMED:LINE_WEBHOOK:PENDING:9999999999999:11111111-1111-4111-8111-111111111111" });
    const deps = dependencies({ listPayments: vi.fn(async () => [recorded]), reconcileTerminalPaymentEffects: vi.fn(async () => false) } as Partial<LineSlipDependencies>);

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "duplicate", payment: recorded });
    expect(deps.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(deps.replyLineMessage).not.toHaveBeenCalled();
  });

  it("uses one deterministic owner and marks it analyzing before OCR", async () => {
    const first = payment({ payment_id: "pay_1" });
    const second = payment({ rowNumber: 3, payment_id: "pay_2", amount_thb: "2500" });
    const calls: string[] = [];
    const deps = dependencies({ analyzeSlip: vi.fn(async () => { calls.push("analyze"); return analysis(); }) }, [first, second]);
    const write = deps.updatePaymentIfUnchanged;
    deps.updatePaymentIfUnchanged = vi.fn(async ({ payment: row }) => { calls.push(`${row.payment_id}:${row.line_slip_processing_status}`); return write({ payment: row, expectedPayment: row }); });

    await processLineSlipEvent(event, deps);

    expect(calls.slice(0, 3)).toEqual(["pay_1:DOWNLOADING", "pay_1:ANALYZING", "analyze"]);
    expect(calls).not.toContain("pay_2:DOWNLOADING");
    expect(calls).not.toContain("pay_2:ANALYZING");
  });

  it("restores temporary owner and advances resolved second payment", async () => {
    const first = payment({ payment_id: "pay_1" });
    const second = payment({ rowNumber: 3, payment_id: "pay_2" });
    const deps = dependencies({ resolveLinePaymentCandidate: vi.fn(() => second) }, [first, second]);

    await processLineSlipEvent(event, deps);

    expect(deps.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ payment_id: "pay_1", line_slip_processing_status: "AWAITING" }) }));
    expect(deps.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ payment_id: "pay_2", line_slip_processing_status: "ANALYZING" }) }));
    expect(deps.processSlipImage).toHaveBeenCalledWith(expect.objectContaining({ expectedPayment: second }));
  });

  it("restores a selected non-owner after shared duplicate detection", async () => {
    const first = payment({ payment_id: "pay_1" });
    const second = payment({ rowNumber: 3, payment_id: "pay_2" });
    const deps = dependencies({
      resolveLinePaymentCandidate: vi.fn(() => second),
      processSlipImage: vi.fn(async ({ expectedPayment }) => ({ decision: "PENDING" as const, duplicate: true, analysis: analysis(), evaluation: null, payment: expectedPayment })),
    }, [first, second]);

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "duplicate", payment: { payment_id: "pay_2" } });
    expect(deps.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ payment_id: "pay_2", line_slip_processing_status: "AWAITING" }) }));
  });

  it("resets temporary owner without OCR for a same-payment image hash", async () => {
    const duplicate = payment({ slip_hash: "image-hash" });
    const deps = dependencies({}, [duplicate]);

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "duplicate", payment: { payment_id: "pay_1", line_slip_processing_status: "AWAITING" } });
    expect(deps.updatePaymentIfUnchanged).toHaveBeenLastCalledWith(expect.objectContaining({ payment: expect.objectContaining({ line_slip_processing_status: "AWAITING" }) }));
    expect(deps.analyzeSlip).not.toHaveBeenCalled();
    expect(deps.processSlipImage).not.toHaveBeenCalled();
  });

  it("leaves another payment's matching image to the shared cross-payment guard", async () => {
    const owner = payment({ payment_id: "pay_1" });
    const other = payment({ rowNumber: 3, payment_id: "pay_2", status: "AUTO_RECORDED", slip_hash: "image-hash", line_slip_expected: "FALSE" });
    const deps = dependencies({}, [owner, other]);

    await processLineSlipEvent(event, deps);

    expect(deps.analyzeSlip).toHaveBeenCalledOnce();
    expect(deps.processSlipImage).toHaveBeenCalledOnce();
  });

  it("uses global message replay state before any progress or content work", async () => {
    const otherClientReplay = payment({ client_id: "client_other", line_source_message_id: "message_1", status: "AUTO_RECORDED" });
    const deps = dependencies({ listPayments: vi.fn(async () => [payment(), otherClientReplay]) });

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "duplicate", payment: otherClientReplay });
    expect(deps.updatePaymentIfUnchanged).not.toHaveBeenCalled();
    expect(deps.getLineMessageContent).not.toHaveBeenCalled();
  });

  it("exits safely when atomic owner progress loses a concurrent update", async () => {
    const deps = dependencies({ updatePaymentIfUnchanged: vi.fn(async () => false) });

    await expect(processLineSlipEvent(event, deps)).resolves.toEqual({ kind: "ignored" });
    expect(deps.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(deps.getLineMessageContent).not.toHaveBeenCalled();
  });

  it("marks a transient download failure without OCR or a reply", async () => {
    const deps = dependencies({ getLineMessageContent: vi.fn(async () => { throw new Error("private upstream detail"); }) });

    await expect(processLineSlipEvent(event, deps)).resolves.toEqual({ kind: "download_failed" });
    expect(deps.updatePaymentIfUnchanged).toHaveBeenLastCalledWith(expect.objectContaining({ payment: expect.objectContaining({ line_slip_processing_status: "FAILED_TRANSIENT", line_slip_error: "LINE content download failed" }) }));
    expect(deps.analyzeSlip).not.toHaveBeenCalled();
    expect(deps.replyLineMessage).not.toHaveBeenCalled();
  });

  it("sends review reply instead of guessing when multiple candidates cannot be resolved", async () => {
    const first = payment({ payment_id: "pay_1" });
    const second = payment({ rowNumber: 3, payment_id: "pay_2" });
    const deps = dependencies({
      resolveLinePaymentCandidate: vi.fn(() => null),
    }, [first, second]);

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "review", decision: "REVIEW" });
    expect(deps.processSlipImage).not.toHaveBeenCalled();
    expect(deps.replyLineMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Payment slip received. It will be reviewed." }));
  });

  it("persists ambiguous review through the shared transition with its linked schedule", async () => {
    const first = payment({ payment_id: "pay_1" });
    const second = payment({ rowNumber: 3, payment_id: "pay_2" });
    const persistPaymentTransition = vi.fn(async () => ({ paymentStatus: "REVIEW", scheduleStatus: "GENERATED" }));
    const deps = dependencies({
      resolveLinePaymentCandidate: vi.fn(() => null),
      persistPaymentTransition,
    }, [first, second]);

    await processLineSlipEvent(event, deps);

    expect(persistPaymentTransition).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ payment_id: "pay_1", status: "PENDING" }), nextStatus: "REVIEW", source: "LINE_WEBHOOK", schedule: expect.objectContaining({ payment_id: "pay_1" }) }));
  });

  it.each([
    ["missing schedule", { listSchedules: vi.fn(async () => []) }],
    ["schedule read failure", { listSchedules: vi.fn(async () => { throw new Error("private sheets detail"); }) }],
    ["transition failure", { persistPaymentTransition: vi.fn(async () => { throw new Error("private transition detail"); }) }],
  ])("recovers ambiguous %s without leaving ANALYZING", async (_case, overrides) => {
    const first = payment({ payment_id: "pay_1" });
    const second = payment({ rowNumber: 3, payment_id: "pay_2" });
    const deps = dependencies({ resolveLinePaymentCandidate: vi.fn(() => null), ...overrides }, [first, second]);

    await expect(processLineSlipEvent(event, deps)).resolves.toEqual({ kind: "failed_transient" });
    expect(deps.updatePaymentIfUnchanged).toHaveBeenLastCalledWith(expect.objectContaining({ payment: expect.objectContaining({ line_slip_processing_status: "FAILED_TRANSIENT", line_slip_error: "LINE slip review failed" }) }));
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_SLIP_REVIEW_FAILED" }));
  });

  it("sends mismatch reply for flagged payment", async () => {
    const deps = dependencies({ processSlipImage: vi.fn(async ({ expectedPayment }) => ({ decision: "FLAGGED" as const, duplicate: false, analysis: analysis(), evaluation: null, payment: { ...expectedPayment, status: "FLAGGED" } })) });

    await processLineSlipEvent(event, deps);

    expect(deps.replyLineMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Payment slip received. Please contact your trainer so they can review it." }));
  });

  it("keeps a recorded payment when reply fails and saves failed reply state on fresh row", async () => {
    const deps = dependencies({
      replyLineMessage: vi.fn(async () => { throw new Error("expired reply token"); }),
    });

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "processed", decision: "AUTO_RECORDED" });
    expect(deps.updatePaymentIfUnchanged).toHaveBeenLastCalledWith(expect.objectContaining({ payment: expect.objectContaining({ status: "AUTO_RECORDED", line_reply_status: "FAILED", line_reply_at: now }) }));
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_PAYMENT_REPLY_FAILED", reason: "LINE reply failed" }));
  });

  it("audits failed reply even when FAILED bookkeeping CAS loses", async () => {
    const deps = dependencies({ replyLineMessage: vi.fn(async () => { throw new Error("expired reply token"); }) });
    const write = deps.updatePaymentIfUnchanged;
    let calls = 0;
    deps.updatePaymentIfUnchanged = vi.fn(async (input) => {
      calls += 1;
      if (calls === 4) return false;
      return write(input);
    });

    await processLineSlipEvent(event, deps);

    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_PAYMENT_REPLY_FAILED", reason: "LINE reply failed" }));
  });

  it("keeps SENDING when reply succeeds but SENT bookkeeping cannot read a fresh row", async () => {
    const deps = dependencies();
    const list = deps.listPayments;
    let calls = 0;
    deps.listPayments = vi.fn(async () => {
      calls += 1;
      if (calls === 6) throw new Error("sheets unavailable");
      return list();
    });

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "processed", decision: "AUTO_RECORDED" });
    expect(deps.replyLineMessage).toHaveBeenCalledOnce();
    expect(deps.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ line_reply_status: "SENDING" }) }));
    expect(deps.updatePaymentIfUnchanged).not.toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ line_reply_status: "FAILED" }) }));
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_PAYMENT_REPLY_STATUS_FAILED" }));
  });

  it("keeps SENDING when reply succeeds but SENT bookkeeping update fails", async () => {
    const deps = dependencies();
    const write = deps.updatePaymentIfUnchanged;
    let calls = 0;
    deps.updatePaymentIfUnchanged = vi.fn(async ({ payment: row, expectedPayment }) => {
      calls += 1;
      if (calls === 4) throw new Error("sheets write unavailable");
      return write({ payment: row, expectedPayment });
    });

    await expect(processLineSlipEvent(event, deps)).resolves.toMatchObject({ kind: "processed", decision: "AUTO_RECORDED" });
    expect(deps.replyLineMessage).toHaveBeenCalledOnce();
    expect(deps.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ line_reply_status: "SENDING" }) }));
    expect(deps.updatePaymentIfUnchanged).not.toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ line_reply_status: "FAILED" }) }));
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_PAYMENT_REPLY_STATUS_FAILED" }));
  });
});
