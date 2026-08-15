import { randomUUID } from "node:crypto";
import { bangkokDateKey } from "@/lib/date";
import { runtimeConfig } from "@/lib/runtime-config";
import { getLineChannelAccessToken } from "@/lib/secrets/service";
import { appendAudit, updatePayment } from "@/lib/sheets/payments";
import { readPaymentClientSnapshot } from "@/lib/sheets/payment-client-snapshot";
import { getLineInstallmentReminderConfig } from "@/lib/sheets/settings";
import { renderLineDueMessageProfile } from "./message-profile";
import { eligibleReminderSlots, parseReminderDeliveryLog, serializeReminderDeliveryLog, updateReminderDelivery } from "./reminder-delivery";
import { resolveLineDueMessageValues } from "./message-values";
import { isLinkedLinePaymentRecipient } from "./recipient";
import { sendLinePushMessage } from "./client";

function qrUrl(baseUrl: string, token: string): string {
  return new URL(`/api/payments/${encodeURIComponent(token)}/promptpay-qr.png`, baseUrl).toString();
}

export async function sendInstallmentReminderRequests({ baseUrl, today = bangkokDateKey() }: { baseUrl: string; today?: string }): Promise<string[]> {
  const config = await runtimeConfig();
  if (!config.lineMessagingEnabled) return [];
  const [snapshot, resolved] = await Promise.all([readPaymentClientSnapshot(), getLineInstallmentReminderConfig()]);
  if (resolved.kind === "INVALID") return [];
  const clients = new Map(snapshot.clients.map((client) => [client.client_id, client]));
  let tokenPromise: Promise<string> | undefined;
  const accepted: string[] = [];
  for (const payment of snapshot.payments) {
    if (payment.status !== "PENDING" || payment.payment_type !== "INSTALLMENTS" || Number(payment.installment_number) <= 1) continue;
    let log;
    try { log = parseReminderDeliveryLog(payment.line_reminder_delivery_log); } catch { continue; }
    const enabledSlots = eligibleReminderSlots({ dueDate: payment.due_date, createdAt: payment.created_at, today, log })
      .filter((slot) => resolved.config.enabled[slot]);
    if (enabledSlots.length === 0) continue;
    const recipient = clients.get(payment.client_id);
    for (const slot of enabledSlots) {
      if (!isLinkedLinePaymentRecipient(recipient)) {
        log = updateReminderDelivery(log, slot, { status: "SKIPPED_MISSING_USER_ID", errorCode: "MISSING_USER_ID" });
        continue;
      }
      tokenPromise ??= getLineChannelAccessToken();
      const token = await tokenPromise;
      const existing = log.deliveries[slot];
      const retryKey = existing?.retryKey || randomUUID();
      let message: string;
      try {
        message = existing?.renderedMessage || renderLineDueMessageProfile(resolved.config.profiles[slot], "INSTALLMENTS", resolveLineDueMessageValues({ payment, client: recipient, schedules: snapshot.schedules }).values);
      } catch { log = updateReminderDelivery(log, slot, { status: "FAILED_RETRYABLE", errorCode: "TEMPLATE_INVALID" }); continue; }
      log = updateReminderDelivery(log, slot, { status: "SENDING", renderedMessage: message, retryKey, firstAttemptedAt: existing?.firstAttemptedAt || new Date().toISOString() });
      await updatePayment({ ...payment, line_reminder_delivery_log: serializeReminderDeliveryLog(log), updated_at: new Date().toISOString() });
      const result = await sendLinePushMessage({ channelAccessToken: token, to: recipient.line_user_id, retryKey, messages: [{ type: "text", text: message }, { type: "image", originalContentUrl: qrUrl(baseUrl, payment.public_token), previewImageUrl: qrUrl(baseUrl, payment.public_token) }], fetchFn: fetch });
      log = updateReminderDelivery(log, slot, result.accepted ? { status: "ACCEPTED", acceptedAt: new Date().toISOString(), requestId: result.requestId } : { status: result.retryable ? "FAILED_RETRYABLE" : "FAILED", renderedMessage: message, retryKey, errorCode: result.errorCode });
      await updatePayment({ ...payment, line_reminder_delivery_log: serializeReminderDeliveryLog(log), updated_at: new Date().toISOString() });
      await appendAudit({ paymentId: payment.payment_id, clientId: payment.client_id, action: result.accepted ? "LINE_INSTALLMENT_REMINDER_ACCEPTED" : "LINE_INSTALLMENT_REMINDER_FAILED", previousStatus: "PENDING", newStatus: result.accepted ? "ACCEPTED" : "FAILED", reason: "Installment reminder delivery", source: "LINE_REMINDER_SENDER", metadata: JSON.stringify({ paymentId: payment.payment_id, slot, status: result.accepted ? "ACCEPTED" : "FAILED", requestCode: result.errorCode || result.requestId }) });
      if (result.accepted) accepted.push(payment.payment_id);
    }
  }
  return accepted;
}
