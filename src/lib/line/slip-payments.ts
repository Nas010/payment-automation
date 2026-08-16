import { replyLineMessage, getLineMessageContent } from "@/lib/line/client";
import { getLineChannelAccessToken } from "@/lib/secrets/service";
import { getLineAutomaticReplyConfig } from "@/lib/sheets/settings";
import { lineSlipReplyText, type LineAutomaticReplyConfig } from "@/lib/line/reply-config";
import { resolveLinePaymentCandidate } from "@/lib/line/payment-match";
import { persistPaymentTransition, reconcileTerminalPaymentEffects } from "@/lib/payments/transition";
import { runtimeConfig } from "@/lib/runtime-config";
import { sha256 } from "@/lib/slip/hash";
import { processSlipImage, type SlipProcessResult } from "@/lib/slip/process";
import { analyzeSlip, type SlipAnalysis } from "@/lib/slip/analyze";
import { appendAudit, listPayments, updatePayment, updatePaymentIfUnchanged, type PaymentRecord } from "@/lib/sheets/payments";
import { listSchedules, type ScheduleRecord } from "@/lib/sheets/schedules";
import { listClients, type ClientRecord } from "@/lib/sheets/clients";

export type LineSlipEvent = { webhookEventId: string; replyToken: string; lineUserId: string; messageId: string };

type LineSlipResult =
  | { kind: "ignored" }
  | { kind: "duplicate"; payment: PaymentRecord }
  | { kind: "download_failed" }
  | { kind: "failed_transient" }
  | { kind: "review"; decision: "REVIEW"; payment: PaymentRecord }
  | { kind: "processed"; decision: SlipProcessResult["decision"]; payment: PaymentRecord };

export type LineSlipDependencies = {
  listClients: () => Promise<ClientRecord[]>;
  listPayments: () => Promise<PaymentRecord[]>;
  listSchedules: () => Promise<ScheduleRecord[]>;
  updatePayment: (payment: PaymentRecord) => Promise<void>;
  updatePaymentIfUnchanged: typeof updatePaymentIfUnchanged;
  appendAudit: typeof appendAudit;
  persistPaymentTransition: typeof persistPaymentTransition;
  reconcileTerminalPaymentEffects: typeof reconcileTerminalPaymentEffects;
  lineChatPaymentsEnabled: () => boolean;
  automaticReplyConfig: LineAutomaticReplyConfig;
  receiverAliases: () => string[];
  getLineChannelAccessToken: () => Promise<string>;
  getLineMessageContent: typeof getLineMessageContent;
  hashSlipImage: (bytes: Uint8Array) => string;
  analyzeSlip: (bytes: Uint8Array, declaredType: string, receiverAliases?: string[]) => Promise<SlipAnalysis>;
  resolveLinePaymentCandidate: typeof resolveLinePaymentCandidate;
  processSlipImage: typeof processSlipImage;
  replyLineMessage: typeof replyLineMessage;
  now: () => string;
};

async function defaultDependencies(): Promise<LineSlipDependencies> {
  const [config, automaticReplyConfig] = await Promise.all([runtimeConfig(), getLineAutomaticReplyConfig()]);
  return { listClients, listPayments, listSchedules, updatePayment, updatePaymentIfUnchanged, appendAudit, persistPaymentTransition, reconcileTerminalPaymentEffects, lineChatPaymentsEnabled: () => config.lineChatPaymentsEnabled, automaticReplyConfig, receiverAliases: () => [config.recipientNameEn, config.recipientNameTh, ...config.recipientAliases].filter(Boolean), getLineChannelAccessToken, getLineMessageContent, hashSlipImage: sha256, analyzeSlip: (bytes, declaredType, aliases) => analyzeSlip(bytes, declaredType, aliases, { ocrEnabled: config.ocrEnabled }), resolveLinePaymentCandidate, processSlipImage, replyLineMessage, now: () => new Date().toISOString() };
}

function linkedClient(clients: ClientRecord[], lineUserId: string): ClientRecord | null {
  return clients.find((client) => client.active === "TRUE" && client.line_link_status === "LINKED" && client.line_user_id === lineUserId) ?? null;
}

function eligiblePayments(payments: PaymentRecord[], clientId: string): PaymentRecord[] {
  return payments.filter((payment) => payment.client_id === clientId && payment.status === "PENDING" && payment.line_slip_expected === "TRUE" && ["AWAITING", "FAILED_TRANSIENT"].includes(payment.line_slip_processing_status));
}

async function audit(dependencies: LineSlipDependencies, payment: PaymentRecord, action: string, reason: string, event: LineSlipEvent): Promise<void> {
  try {
    await dependencies.appendAudit({ paymentId: payment.payment_id, clientId: payment.client_id, action, previousStatus: payment.status, newStatus: payment.status, reason, source: "LINE_WEBHOOK", metadata: JSON.stringify({ webhookEventId: event.webhookEventId, messageId: event.messageId }) });
  } catch {
    // Signed webhook acknowledgement must not depend on audit availability.
  }
}

async function currentPayment(dependencies: LineSlipDependencies, paymentId: string): Promise<PaymentRecord | null> {
  return (await dependencies.listPayments()).find((payment) => payment.payment_id === paymentId) ?? null;
}

async function progress(dependencies: LineSlipDependencies, paymentId: string, expected: string | string[], nextStatus: string, error = ""): Promise<PaymentRecord | null> {
  const current = await currentPayment(dependencies, paymentId);
  const expectedStates = Array.isArray(expected) ? expected : [expected];
  if (!current || current.status !== "PENDING" || current.line_slip_expected !== "TRUE" || !expectedStates.includes(current.line_slip_processing_status)) return null;
  const next = { ...current, line_slip_processing_status: nextStatus, line_slip_error: error, updated_at: dependencies.now() };
  if (await dependencies.updatePaymentIfUnchanged({ expectedPayment: current, payment: next })) return next;
  await currentPayment(dependencies, paymentId);
  return null;
}

function replyCanBeRetried(status: string): boolean {
  return status === "" || status === "FAILED";
}

function terminalEffectsClaimedOrPending(marker: string): boolean {
  return /^(TRANSITION_EFFECTS_PENDING|TRANSITION_EFFECTS_CLAIMED):/.test(marker);
}

function latestPayment(first: PaymentRecord, second: PaymentRecord): PaymentRecord {
  const firstTime = Date.parse(first.updated_at);
  const secondTime = Date.parse(second.updated_at);
  if (Number.isNaN(firstTime)) return second;
  if (Number.isNaN(secondTime)) return first;
  return firstTime >= secondTime ? first : second;
}

async function writeReplyStatus(dependencies: LineSlipDependencies, payment: PaymentRecord, status: "SENDING" | "SENT" | "FAILED"): Promise<PaymentRecord> {
  const fresh = await currentPayment(dependencies, payment.payment_id);
  if (!fresh) throw new Error("Payment no longer exists while recording LINE reply");
  const base = latestPayment(fresh, payment);
  const next = { ...base, line_reply_status: status, line_reply_at: dependencies.now(), updated_at: dependencies.now() };
  if (!await dependencies.updatePaymentIfUnchanged({ expectedPayment: fresh, payment: next })) {
    await currentPayment(dependencies, payment.payment_id);
    throw new Error("Payment changed while recording LINE reply");
  }
  return next;
}

async function auditReplyStatusFailure(dependencies: LineSlipDependencies, payment: PaymentRecord, reason: string, event: LineSlipEvent): Promise<void> {
  await audit(dependencies, payment, "LINE_PAYMENT_REPLY_STATUS_FAILED", reason, event);
}

async function replyAfterResult(dependencies: LineSlipDependencies, payment: PaymentRecord, event: LineSlipEvent, channelAccessToken: string): Promise<void> {
  try {
    await writeReplyStatus(dependencies, payment, "SENDING");
  } catch {
    await auditReplyStatusFailure(dependencies, payment, "LINE reply was not started because SENDING status could not be saved", event);
    return;
  }

  try {
    await dependencies.replyLineMessage({ channelAccessToken, replyToken: event.replyToken, text: lineSlipReplyText(dependencies.automaticReplyConfig), fetchFn: fetch });
  } catch {
    await audit(dependencies, payment, "LINE_PAYMENT_REPLY_FAILED", "LINE reply failed", event);
    try {
      await writeReplyStatus(dependencies, payment, "FAILED");
    } catch {
      await auditReplyStatusFailure(dependencies, payment, "LINE reply failed and FAILED status could not be saved", event);
    }
    return;
  }

  try {
    const sent = await writeReplyStatus(dependencies, payment, "SENT");
    await audit(dependencies, sent, "LINE_SLIP_REPLY_SENT", "LINE reply accepted", event);
  } catch {
    await auditReplyStatusFailure(dependencies, payment, "LINE reply succeeded but SENT status could not be saved", event);
  }
}

async function transitionAmbiguousReview(dependencies: LineSlipDependencies, ownerId: string, event: LineSlipEvent): Promise<PaymentRecord | "FAILED" | null> {
  try {
    const payment = await currentPayment(dependencies, ownerId);
    if (!payment || payment.status !== "PENDING" || payment.line_slip_expected !== "TRUE" || payment.line_slip_processing_status !== "ANALYZING") return null;
    const schedule = (await dependencies.listSchedules()).find((item) => item.payment_id === payment.payment_id);
    if (!schedule) return "FAILED";
    const now = dependencies.now();
    const review = { ...payment, status: "REVIEW", line_source_message_id: event.messageId, line_slip_processing_status: "REVIEW", line_slip_error: "Multiple eligible payments require review", line_slip_received_at: now, updated_at: now };
    await dependencies.persistPaymentTransition({ payment, schedule, nextStatus: "REVIEW", source: "LINE_WEBHOOK", reason: "Multiple eligible payments could not be resolved", paymentUpdate: review, now });
    return review;
  } catch {
    return "FAILED";
  }
}

async function recoverAmbiguousFailure(dependencies: LineSlipDependencies, ownerId: string, event: LineSlipEvent): Promise<void> {
  try {
    const failed = await progress(dependencies, ownerId, "ANALYZING", "FAILED_TRANSIENT", "LINE slip review failed");
    if (failed) await audit(dependencies, failed, "LINE_SLIP_REVIEW_FAILED", "LINE slip review failed", event);
  } catch {
    // A concurrent winner may have moved this row out of ANALYZING.
  }
}

/** Handles one eligible direct-user LINE image after signature verification. */
export async function processLineSlipEvent(event: LineSlipEvent, injected?: LineSlipDependencies): Promise<LineSlipResult> {
  let dependencies: LineSlipDependencies;
  try { dependencies = injected ?? await defaultDependencies(); } catch { return { kind: "ignored" }; }
  if (!dependencies.lineChatPaymentsEnabled()) return { kind: "ignored" };
  const client = linkedClient(await dependencies.listClients(), event.lineUserId);
  if (!client) return { kind: "ignored" };

  const allPayments = await dependencies.listPayments();
  const replay = allPayments.find((payment) => payment.line_source_message_id === event.messageId);
  if (replay) {
    if (replay.client_id !== client.client_id || !["AUTO_RECORDED", "MANUAL_CONFIRMED"].includes(replay.status)) return { kind: "duplicate", payment: replay };
    const schedule = (await dependencies.listSchedules()).find((item) => item.payment_id === replay.payment_id);
    if (!schedule) return { kind: "failed_transient" };
    try {
      const reconciled = await dependencies.reconcileTerminalPaymentEffects({ payment: replay, schedule, now: dependencies.now() });
      if (terminalEffectsClaimedOrPending(replay.line_slip_error) && !reconciled) return { kind: "duplicate", payment: replay };
      if (replyCanBeRetried(replay.line_reply_status)) {
        const channelAccessToken = await dependencies.getLineChannelAccessToken();
        await replyAfterResult(dependencies, replay, event, channelAccessToken);
      }
    } catch {
      return { kind: "failed_transient" };
    }
    return { kind: "duplicate", payment: replay };
  }
  const candidates = eligiblePayments(allPayments, client.client_id);
  const owner = [...candidates].sort((left, right) => left.payment_id.localeCompare(right.payment_id))[0];
  if (!owner) return { kind: "ignored" };
  if (!await progress(dependencies, owner.payment_id, ["AWAITING", "FAILED_TRANSIENT"], "DOWNLOADING")) return { kind: "ignored" };

  let channelAccessToken: string;
  let content: { bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" };
  try {
    channelAccessToken = await dependencies.getLineChannelAccessToken();
    content = await dependencies.getLineMessageContent({ channelAccessToken, messageId: event.messageId, fetchFn: fetch });
  } catch {
    const failed = await progress(dependencies, owner.payment_id, "DOWNLOADING", "FAILED_TRANSIENT", "LINE content download failed");
    if (failed) await audit(dependencies, failed, "LINE_SLIP_DOWNLOAD_FAILED", "LINE content download failed", event);
    return { kind: "download_failed" };
  }

  const imageHash = dependencies.hashSlipImage(content.bytes);
  const imageDuplicate = (await dependencies.listPayments()).find((payment) => payment.payment_id === owner.payment_id && payment.slip_hash === imageHash);
  if (imageDuplicate) {
    const restored = await progress(dependencies, owner.payment_id, "DOWNLOADING", "AWAITING");
    return { kind: "duplicate", payment: restored ?? imageDuplicate };
  }
  if (!await progress(dependencies, owner.payment_id, "DOWNLOADING", "ANALYZING")) return { kind: "ignored" };

  const receiverAliases = [...dependencies.receiverAliases()];
  let analysis: SlipAnalysis;
  try {
    analysis = await dependencies.analyzeSlip(content.bytes, content.mimeType, receiverAliases);
  } catch {
    const failed = await progress(dependencies, owner.payment_id, "ANALYZING", "FAILED_TRANSIENT", "LINE slip analysis failed");
    if (failed) await audit(dependencies, failed, "LINE_SLIP_ANALYSIS_FAILED", "LINE slip analysis failed", event);
    return { kind: "failed_transient" };
  }
  const selected = dependencies.resolveLinePaymentCandidate(candidates, analysis);
  if (!selected) {
    const review = await transitionAmbiguousReview(dependencies, owner.payment_id, event);
    if (review === "FAILED") {
      await recoverAmbiguousFailure(dependencies, owner.payment_id, event);
      return { kind: "failed_transient" };
    }
    if (!review) return { kind: "ignored" };
    await replyAfterResult(dependencies, review, event, channelAccessToken);
    return { kind: "review", decision: "REVIEW", payment: review };
  }
  if (selected.payment_id !== owner.payment_id) {
    if (!await progress(dependencies, owner.payment_id, "ANALYZING", "AWAITING")) return { kind: "ignored" };
    if (!await progress(dependencies, selected.payment_id, "AWAITING", "ANALYZING")) return { kind: "ignored" };
  }

  let result: SlipProcessResult;
  try {
    result = await dependencies.processSlipImage({ bytes: content.bytes, declaredType: content.mimeType, expectedPayment: selected, source: { type: "LINE", lineUserId: event.lineUserId, lineMessageId: event.messageId, clientId: client.client_id }, analysis, receiverAliases });
  } catch {
    const failed = await progress(dependencies, selected.payment_id, "ANALYZING", "FAILED_TRANSIENT", "LINE slip processing failed");
    if (failed) await audit(dependencies, failed, "LINE_SLIP_PROCESSING_FAILED", "LINE slip processing failed", event);
    return { kind: "failed_transient" };
  }
  if (result.duplicate) {
    await progress(dependencies, selected.payment_id, "ANALYZING", "AWAITING");
    return { kind: "duplicate", payment: result.payment };
  }
  await replyAfterResult(dependencies, result.payment, event, channelAccessToken);
  return { kind: "processed", decision: result.decision, payment: result.payment };
}
