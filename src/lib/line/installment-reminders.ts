import { randomUUID } from "node:crypto";
import { bangkokDateKey } from "@/lib/date";
import { runtimeConfig } from "@/lib/runtime-config";
import { getLineChannelAccessToken } from "@/lib/secrets/service";
import { appendAudit, getPaymentById, updatePaymentIfUnchanged, type PaymentRecord } from "@/lib/sheets/payments";
import { readPaymentClientSnapshot } from "@/lib/sheets/payment-client-snapshot";
import { PAYMENT_HEADERS, recordToRow } from "@/lib/sheets/records";
import { getLineInstallmentReminderConfig } from "@/lib/sheets/settings";
import { renderLineDueMessageProfile, type ReminderSlot } from "./message-profile";
import { eligibleReminderSlots, parseReminderDeliveryLog, serializeReminderDeliveryLog, updateReminderDelivery, type ReminderDelivery, type ReminderDeliveryLog } from "./reminder-delivery";
import { resolveLineDueMessageValues } from "./message-values";
import { isLinkedLinePaymentRecipient } from "./recipient";
import { sendLinePushMessage } from "./client";

function qrUrl(baseUrl: string, token: string): string {
  return new URL(`/api/payments/${encodeURIComponent(token)}/promptpay-qr.png`, baseUrl).toString();
}

async function auditReminder(payment: PaymentRecord, slot: ReminderSlot | undefined, action: string, status: string, requestCode: string): Promise<void> {
  try {
    await appendAudit({
      paymentId: payment.payment_id, clientId: payment.client_id, action, previousStatus: "PENDING", newStatus: status,
      reason: "Installment reminder delivery", source: "LINE_REMINDER_SENDER",
      metadata: JSON.stringify({ paymentId: payment.payment_id, slot, status, requestCode }),
    });
  } catch {
    // Keep delivery independent of the audit ledger, without logging payloads or secrets.
    console.warn("LINE_REMINDER_AUDIT_UNAVAILABLE", { action, status, requestCode });
  }
}

/** Retry a repaired state token only while the complete invoice is unchanged. */
async function persistReminderLog(expected: PaymentRecord, log: ReminderDeliveryLog): Promise<PaymentRecord | null> {
  let current = expected;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const next = { ...current, line_reminder_delivery_log: serializeReminderDeliveryLog(log), updated_at: new Date().toISOString() };
    if (await updatePaymentIfUnchanged({ expectedPayment: current, payment: next })) return next;
    if (attempt === 1) return null;
    const refreshed = await getPaymentById(current.payment_id);
    if (!refreshed || refreshed.status !== "PENDING") return null;
    const actualRow = recordToRow(PAYMENT_HEADERS, refreshed);
    if (!recordToRow(PAYMENT_HEADERS, current).every((value, index) => value === actualRow[index])) return null;
    current = refreshed;
  }
  return null;
}

function ambiguousRetryExpired(delivery: ReminderDelivery | undefined): boolean {
  if (!delivery?.retryKey || (delivery.status !== "SENDING" && delivery.errorCode !== "NETWORK_ERROR")) return false;
  const attemptedAt = Date.parse(delivery.firstAttemptedAt ?? "");
  return !Number.isFinite(attemptedAt) || Date.now() - attemptedAt >= 24 * 60 * 60 * 1000;
}

export async function sendInstallmentReminderRequests({ baseUrl, today = bangkokDateKey(), slots }: { baseUrl: string; today?: string; slots?: readonly ReminderSlot[] }): Promise<string[]> {
  const config = await runtimeConfig();
  if (!config.lineMessagingEnabled) return [];
  const [snapshot, resolved] = await Promise.all([readPaymentClientSnapshot(), getLineInstallmentReminderConfig()]);
  if (resolved.kind === "INVALID") throw new Error("LINE_REMINDER_CONFIG_INVALID");
  const clients = new Map(snapshot.clients.map((client) => [client.client_id, client]));
  let tokenPromise: Promise<string> | undefined;
  const accepted: string[] = [];
  for (const payment of snapshot.payments) {
    const number = Number(payment.installment_number);
    if (payment.status !== "PENDING" || payment.payment_type !== "INSTALLMENTS" || !Number.isSafeInteger(number) || number <= 1) continue;
    let log: ReminderDeliveryLog;
    try {
      log = parseReminderDeliveryLog(payment.line_reminder_delivery_log);
    } catch {
      await auditReminder(payment, undefined, "LINE_INSTALLMENT_REMINDER_FAILED", "REVIEW", "INVALID_DELIVERY_LOG");
      continue;
    }
    let enabledSlots: ReminderSlot[];
    try {
      enabledSlots = eligibleReminderSlots({ dueDate: payment.due_date, createdAt: payment.created_at, today, log })
        .filter((slot) => resolved.config.enabled[slot] && (!slots || slots.includes(slot)));
    } catch {
      await auditReminder(payment, undefined, "LINE_INSTALLMENT_REMINDER_FAILED", "REVIEW", "INVALID_REMINDER_DATE");
      continue;
    }
    if (enabledSlots.length === 0) continue;
    const recipient = clients.get(payment.client_id);
    let currentPayment = payment;
    for (const slot of enabledSlots) {
      const save = async (delivery: ReminderDelivery): Promise<boolean> => {
        const nextLog = updateReminderDelivery(log, slot, delivery);
        const saved = await persistReminderLog(currentPayment, nextLog);
        if (!saved) {
          await auditReminder(currentPayment, slot, "LINE_INSTALLMENT_REMINDER_DEFERRED", "DEFERRED", "PAYMENT_STATE_CHANGED");
          return false;
        }
        currentPayment = saved;
        log = nextLog;
        return true;
      };
      try {
        const existing = log.deliveries[slot];
        if (ambiguousRetryExpired(existing)) {
          if (await save({ ...existing, status: "REVIEW", errorCode: "DELIVERY_AMBIGUOUS" })) {
            await auditReminder(payment, slot, "LINE_INSTALLMENT_REMINDER_REVIEW", "REVIEW", "DELIVERY_AMBIGUOUS");
          }
          continue;
        }
        if (!isLinkedLinePaymentRecipient(recipient)) {
          if (await save({ ...existing, status: "SKIPPED_MISSING_USER_ID", errorCode: "MISSING_USER_ID" })) {
            await auditReminder(payment, slot, "LINE_INSTALLMENT_REMINDER_SKIPPED", "SKIPPED_MISSING_USER_ID", "MISSING_USER_ID");
          }
          continue;
        }
        let message: string;
        try {
          message = existing?.renderedMessage || renderLineDueMessageProfile(resolved.config.profiles[slot], "INSTALLMENTS", resolveLineDueMessageValues({ payment: currentPayment, client: recipient, schedules: snapshot.schedules }).values);
        } catch {
          if (await save({ ...existing, status: "FAILED_RETRYABLE", errorCode: "TEMPLATE_INVALID" })) {
            await auditReminder(payment, slot, "LINE_INSTALLMENT_REMINDER_FAILED", "FAILED_RETRYABLE", "TEMPLATE_INVALID");
          }
          continue;
        }
        let token: string;
        try {
          tokenPromise ??= getLineChannelAccessToken();
          token = await tokenPromise;
        } catch {
          if (await save({ ...existing, status: "FAILED_RETRYABLE", errorCode: "CREDENTIALS_UNAVAILABLE" })) {
            await auditReminder(payment, slot, "LINE_INSTALLMENT_REMINDER_FAILED", "FAILED_RETRYABLE", "CREDENTIALS_UNAVAILABLE");
          }
          continue;
        }
        const imageUrl = qrUrl(baseUrl, currentPayment.public_token);
        const retryKey = existing?.retryKey || randomUUID();
        if (!await save({ status: "SENDING", renderedMessage: message, retryKey, firstAttemptedAt: existing?.firstAttemptedAt || new Date().toISOString() })) break;
        let result;
        try {
          result = await sendLinePushMessage({ channelAccessToken: token, to: recipient.line_user_id, retryKey, messages: [{ type: "text", text: message }, { type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl }], fetchFn: fetch });
        } catch {
          result = { accepted: false, retryable: true, requestId: "", errorCode: "NETWORK_ERROR" };
        }
        const delivery: ReminderDelivery = {
          ...log.deliveries[slot]!,
          status: result.accepted ? "ACCEPTED" : result.retryable ? "FAILED_RETRYABLE" : "FAILED",
          ...(result.accepted ? { acceptedAt: new Date().toISOString(), requestId: result.requestId } : { errorCode: result.errorCode }),
        };
        if (result.accepted) accepted.push(payment.payment_id);
        await save(delivery);
        await auditReminder(payment, slot, result.accepted ? "LINE_INSTALLMENT_REMINDER_ACCEPTED" : "LINE_INSTALLMENT_REMINDER_FAILED", delivery.status, result.errorCode || result.requestId);
      } catch {
        // One invoice or ledger failure must not stop reminders for the following clients.
        await auditReminder(payment, slot, "LINE_INSTALLMENT_REMINDER_DEFERRED", "DEFERRED", "WORKFLOW_UNAVAILABLE");
      }
    }
  }
  return accepted;
}
