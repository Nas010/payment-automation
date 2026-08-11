import { randomUUID } from "node:crypto";
import { bangkokDateKey } from "@/lib/date";
import { formatThb, parseSatang } from "@/lib/money";
import { lineMessagingEnabled } from "@/lib/config";
import { getLineChannelAccessToken } from "@/lib/secrets/service";
import { listClients, type ClientRecord } from "@/lib/sheets/clients";
import { hasLineAuditEvent, type LineAuditEventIdentity } from "@/lib/sheets/audit";
import { appendAudit, listPayments, updatePayment, type PaymentAuditInput, type PaymentRecord } from "@/lib/sheets/payments";
import { getLineDueTemplate } from "@/lib/sheets/settings";
import { sendLinePushMessage } from "./client";
import { renderLineDueTemplate } from "./message-template";
import { isLinkedLinePaymentRecipient } from "./recipient";

type LinePushResult = { accepted: boolean; retryable: boolean; requestId: string; errorCode: string };
type LinePushRequest = Omit<Parameters<typeof sendLinePushMessage>[0], "fetchFn">;

export type LineDueDependencies = {
  listPayments: () => Promise<PaymentRecord[]>;
  listClients: () => Promise<ClientRecord[]>;
  updatePayment: (payment: PaymentRecord) => Promise<void>;
  appendAudit: (record: PaymentAuditInput) => Promise<void>;
  hasAuditEvent: (identity: LineAuditEventIdentity) => Promise<boolean>;
  getLineDueTemplate: () => Promise<string>;
  getLineChannelAccessToken: () => Promise<string>;
  sendPush: (input: LinePushRequest) => Promise<LinePushResult>;
  lineMessagingEnabled: () => boolean;
  createRetryKey: () => string;
  now: () => string;
};

export type SendDueLinePaymentRequestsOptions = {
  baseUrl: string;
  today?: string;
  paymentIds?: string[];
};

export type SendDueLinePaymentRequestsResult = {
  accepted: string[];
  alreadyAccepted: string[];
  skippedMissingUserId: string[];
  failed: string[];
  disabled: boolean;
};

const defaultDependencies: LineDueDependencies = {
  listPayments,
  listClients,
  updatePayment,
  appendAudit,
  hasAuditEvent: hasLineAuditEvent,
  getLineDueTemplate,
  getLineChannelAccessToken,
  sendPush: (input) => sendLinePushMessage({ ...input, fetchFn: fetch }),
  lineMessagingEnabled,
  createRetryKey: randomUUID,
  now: () => new Date().toISOString(),
};

const retryableLineStates = new Set(["SENDING", "FAILED_RETRYABLE"]);
const deliverableLineStates = new Set(["", "PENDING", "SKIPPED_MISSING_USER_ID", "FAILED_RETRYABLE", "SENDING"]);
const acceptedAuditActions = ["LINE_DUE_MESSAGE_ACCEPTED", "LINE_PAYMENT_QR_SENT"] as const;
type AcceptedAuditAction = (typeof acceptedAuditActions)[number];

const acceptedAuditPendingCodes: Record<string, AcceptedAuditAction[]> = {
  AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED: ["LINE_DUE_MESSAGE_ACCEPTED"],
  AUDIT_PENDING_LINE_PAYMENT_QR_SENT: ["LINE_PAYMENT_QR_SENT"],
  AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED_AND_LINE_PAYMENT_QR_SENT: [...acceptedAuditActions],
};

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validPublicToken(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function isPaymentCandidate(payment: PaymentRecord, today: string): boolean {
  const amountSatang = parseSatang(payment.amount_thb);
  return payment.status === "PENDING"
    && validDateKey(payment.due_date)
    && payment.due_date <= today
    && validPublicToken(payment.public_token)
    && validHttpsUrl(payment.payment_url)
    && amountSatang !== null
    && amountSatang > 0;
}

function hasFrozenRetryMessage(payment: PaymentRecord): boolean {
  return Boolean(payment.line_message)
    && Boolean(payment.line_retry_key)
    && retryableLineStates.has(payment.line_message_status);
}

function paymentLabel(dueDate: string): string {
  const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "Asia/Bangkok" }).format(new Date(`${dueDate}T12:00:00+07:00`));
  return `${month} Coaching`;
}

function qrImageUrl(baseUrl: string, publicToken: string): string {
  const url = new URL(`/api/payments/${encodeURIComponent(publicToken)}/promptpay-qr.png`, baseUrl);
  if (url.protocol !== "https:") throw new Error("HTTPS_BASE_URL_REQUIRED");
  return url.toString();
}

function oldAmbiguousAttempt(payment: PaymentRecord, now: string): boolean {
  const ambiguousState = payment.line_message_status === "SENDING"
    || (payment.line_message_status === "FAILED_RETRYABLE" && (!payment.line_message_error || payment.line_message_error === "NETWORK_ERROR"));
  if (!ambiguousState || !payment.line_message_attempted_at || !payment.line_retry_key || !payment.line_message) return false;
  const attemptedAt = Date.parse(payment.line_message_attempted_at);
  const nowAt = Date.parse(now);
  return Number.isFinite(attemptedAt) && Number.isFinite(nowAt) && nowAt - attemptedAt >= 24 * 60 * 60 * 1000;
}

function auditMetadata(paymentId: string, status: string, requestCode: string): string {
  return JSON.stringify({ paymentId, status, requestCode });
}

async function persistPayment(dependencies: LineDueDependencies, payment: PaymentRecord, fields: Partial<PaymentRecord>): Promise<PaymentRecord> {
  const next = { ...payment, ...fields };
  await dependencies.updatePayment(next);
  return next;
}

async function appendLineAudit(
  dependencies: LineDueDependencies,
  payment: PaymentRecord,
  action: string,
  previousStatus: string,
  newStatus: string,
  reason: string,
  requestCode: string,
): Promise<boolean> {
  try {
    await dependencies.appendAudit({
      paymentId: payment.payment_id,
      clientId: payment.client_id,
      action,
      previousStatus,
      newStatus,
      reason,
      source: "LINE_DUE_SENDER",
      metadata: auditMetadata(payment.payment_id, newStatus, requestCode),
    });
    return true;
  } catch {
    return false;
  }
}

function pendingAcceptedAuditCode(actions: AcceptedAuditAction[]): string {
  if (actions.length === 2) return "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED_AND_LINE_PAYMENT_QR_SENT";
  if (actions[0] === "LINE_DUE_MESSAGE_ACCEPTED") return "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED";
  if (actions[0] === "LINE_PAYMENT_QR_SENT") return "AUDIT_PENDING_LINE_PAYMENT_QR_SENT";
  return "";
}

async function appendAcceptedAudit(
  dependencies: LineDueDependencies,
  payment: PaymentRecord,
  action: AcceptedAuditAction,
  previousStatus: string,
): Promise<boolean> {
  return appendLineAudit(
    dependencies,
    payment,
    action,
    previousStatus,
    "ACCEPTED",
    action === "LINE_DUE_MESSAGE_ACCEPTED" ? "LINE accepted due-payment request" : "Exact-payment PromptPay QR sent",
    payment.line_request_id || "UNKNOWN_REQUEST_ID",
  );
}

async function reconcileAcceptedAudits(
  dependencies: LineDueDependencies,
  payment: PaymentRecord,
  actions: AcceptedAuditAction[],
  previousStatus: string,
  now: string,
): Promise<PaymentRecord> {
  const remaining: AcceptedAuditAction[] = [];
  for (const action of actions) {
    try {
      const identity = { paymentId: payment.payment_id, action, requestId: payment.line_request_id || "UNKNOWN_REQUEST_ID" };
      if (await dependencies.hasAuditEvent(identity)) continue;
      if (!await appendAcceptedAudit(dependencies, payment, action, previousStatus)) remaining.push(action);
    } catch {
      remaining.push(action);
    }
  }
  const pendingCode = pendingAcceptedAuditCode(remaining);
  if (!remaining.length && payment.line_message_error === pendingCode) return payment;
  try {
    return await persistPayment(dependencies, payment, { line_message_error: pendingCode, updated_at: now });
  } catch {
    return payment;
  }
}

async function recordWorkflowFailure(
  dependencies: LineDueDependencies,
  payment: PaymentRecord,
  previousStatus: string,
  now: string,
  requestCode: string,
): Promise<void> {
  try {
    const failedPayment = await persistPayment(dependencies, payment, {
      line_message_status: "FAILED_RETRYABLE",
      line_message_error: requestCode,
      updated_at: now,
    });
    await appendLineAudit(dependencies, failedPayment, "LINE_DUE_MESSAGE_FAILED", previousStatus, "FAILED_RETRYABLE", "LINE due-payment workflow failed", requestCode);
  } catch {}
}

function blankResult(disabled: boolean): SendDueLinePaymentRequestsResult {
  return { accepted: [], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled };
}

/** Sends due LINE payment requests sequentially so one row's outcome is persisted before the next request. */
export async function sendDueLinePaymentRequests(
  options: SendDueLinePaymentRequestsOptions,
  dependencies: LineDueDependencies = defaultDependencies,
): Promise<SendDueLinePaymentRequestsResult> {
  if (!dependencies.lineMessagingEnabled()) return blankResult(true);

  const today = options.today ?? bangkokDateKey();
  const now = dependencies.now();
  const selectedIds = options.paymentIds ? new Set(options.paymentIds) : null;
  const result = blankResult(false);
  const [payments, clients] = await Promise.all([dependencies.listPayments(), dependencies.listClients()]);
  const clientsById = new Map(clients.map((client) => [client.client_id, client]));
  let channelAccessToken: string | null = null;

  for (const originalPayment of payments) {
    if (selectedIds && !selectedIds.has(originalPayment.payment_id)) continue;
    if (originalPayment.line_message_status === "ACCEPTED") {
      const pendingAudits = acceptedAuditPendingCodes[originalPayment.line_message_error] ?? [];
      if (pendingAudits.length) await reconcileAcceptedAudits(dependencies, originalPayment, pendingAudits, "ACCEPTED", now);
      result.alreadyAccepted.push(originalPayment.payment_id);
      continue;
    }
    if (!deliverableLineStates.has(originalPayment.line_message_status) || !isPaymentCandidate(originalPayment, today)) continue;

    let payment = originalPayment;
    const previousStatus = payment.line_message_status;
    if (oldAmbiguousAttempt(payment, now)) {
      try {
        payment = await persistPayment(dependencies, payment, {
          status: "REVIEW",
          review_reason: "LINE delivery acceptance is ambiguous; verify before retrying",
          line_message_status: "REVIEW",
          line_message_error: "DELIVERY_AMBIGUOUS",
          updated_at: now,
        });
        await appendLineAudit(dependencies, payment, "LINE_DUE_MESSAGE_FAILED", previousStatus, "REVIEW", "LINE delivery requires review", "DELIVERY_AMBIGUOUS");
      } catch {
        await recordWorkflowFailure(dependencies, payment, previousStatus, now, payment.line_message_error || "NETWORK_ERROR");
      }
      result.failed.push(payment.payment_id);
      continue;
    }

    const recipient = clientsById.get(payment.client_id);
    if (!isLinkedLinePaymentRecipient(recipient)) {
      try {
        payment = await persistPayment(dependencies, payment, {
          line_message_status: "SKIPPED_MISSING_USER_ID",
          line_message_error: "MISSING_USER_ID",
          updated_at: now,
        });
        await appendLineAudit(dependencies, payment, "LINE_DUE_MESSAGE_SKIPPED", previousStatus, "SKIPPED_MISSING_USER_ID", "No active linked LINE recipient", "MISSING_USER_ID");
        result.skippedMissingUserId.push(payment.payment_id);
      } catch {
        await recordWorkflowFailure(dependencies, payment, previousStatus, now, "DELIVERY_ERROR");
        result.failed.push(payment.payment_id);
      }
      continue;
    }

    try {
      const retryKey = payment.line_retry_key || dependencies.createRetryKey();
      const firstAttemptAt = payment.line_retry_key && payment.line_message_attempted_at ? payment.line_message_attempted_at : now;
      let sawAmbiguousFailure = payment.line_message_status === "SENDING" || payment.line_message_error === "NETWORK_ERROR";
      const lineMessage = hasFrozenRetryMessage(payment) ? payment.line_message : renderLineDueTemplate(await dependencies.getLineDueTemplate(), {
        client_name: recipient.client_name,
        payment_label: paymentLabel(payment.due_date),
        amount: formatThb(parseSatang(payment.amount_thb)!),
        due_date: payment.due_date,
        payment_url: payment.payment_url,
      });
      const imageUrl = qrImageUrl(options.baseUrl, payment.public_token);
      channelAccessToken ??= await dependencies.getLineChannelAccessToken();
      let pushResult: LinePushResult = { accepted: false, retryable: true, requestId: "", errorCode: "NETWORK_ERROR" };

      for (let attempt = 0; attempt < 3; attempt += 1) {
        payment = await persistPayment(dependencies, payment, {
          line_retry_key: retryKey,
          line_message: lineMessage,
          line_message_status: "SENDING",
          line_message_attempted_at: firstAttemptAt,
          line_message_error: sawAmbiguousFailure ? "NETWORK_ERROR" : "",
          updated_at: now,
        });
        try {
          pushResult = await dependencies.sendPush({
            channelAccessToken,
            to: recipient.line_user_id,
            retryKey,
            messages: [
              { type: "text", text: lineMessage },
              { type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl },
            ],
          });
        } catch {
          pushResult = { accepted: false, retryable: true, requestId: "", errorCode: "NETWORK_ERROR" };
        }
        if (pushResult.errorCode === "NETWORK_ERROR") sawAmbiguousFailure = true;
        if (pushResult.accepted || !pushResult.retryable) break;
      }

      if (pushResult.accepted) {
        payment = await persistPayment(dependencies, payment, {
          line_message_status: "ACCEPTED",
          line_message_sent_at: now,
          line_request_id: pushResult.requestId,
          line_message_error: pendingAcceptedAuditCode([...acceptedAuditActions]),
          line_payment_requested_at: now,
          line_slip_expected: "TRUE",
          line_slip_processing_status: "AWAITING",
          updated_at: now,
        });
        payment = await reconcileAcceptedAudits(dependencies, payment, [...acceptedAuditActions], previousStatus, now);
        result.accepted.push(payment.payment_id);
        continue;
      }

      const failedStatus = pushResult.retryable ? "FAILED_RETRYABLE" : "FAILED";
      const requestCode = sawAmbiguousFailure ? "NETWORK_ERROR" : pushResult.errorCode || "LINE_REQUEST_FAILED";
      payment = await persistPayment(dependencies, payment, {
        line_message_status: failedStatus,
        line_message_error: requestCode,
        updated_at: now,
      });
      await appendLineAudit(dependencies, payment, "LINE_DUE_MESSAGE_FAILED", previousStatus, failedStatus, "LINE did not accept due-payment request", requestCode);
      result.failed.push(payment.payment_id);
    } catch {
      const requestCode = retryableLineStates.has(payment.line_message_status) ? "NETWORK_ERROR" : "DELIVERY_ERROR";
      await recordWorkflowFailure(dependencies, payment, previousStatus, now, requestCode);
      result.failed.push(payment.payment_id);
    }
  }

  return result;
}
