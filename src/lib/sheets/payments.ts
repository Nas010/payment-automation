import { getGoogleSheets } from "./client";
import { PAYMENT_HEADERS, recordToRow, rowToRecord, type RowRecord } from "./records";
import { needsManualConfirmationAudit } from "@/lib/payments/manual-confirmation";

export type PaymentRecord = RowRecord & { payment_id: string; client_id: string; public_token: string; status: string; amount_thb: string; transaction_ref: string; originating_bank: string; slip_hash: string; created_at: string; recorded_at: string; manual_confirmed_at: string };

export async function listPayments(): Promise<PaymentRecord[]> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Payments!A:AD" });
  return (response.data.values ?? []).slice(1).filter((row) => row[0]).map((row) => rowToRecord(PAYMENT_HEADERS, row) as PaymentRecord);
}

export async function getPaymentByToken(token: string): Promise<PaymentRecord | null> {
  return (await listPayments()).find((payment) => payment.public_token === token) ?? null;
}

export async function getPaymentById(paymentId: string): Promise<PaymentRecord | null> {
  return (await listPayments()).find((payment) => payment.payment_id === paymentId) ?? null;
}

export async function appendPayment(payment: PaymentRecord): Promise<void> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  await sheets.spreadsheets.values.append({ spreadsheetId, range: "Payments!A:AD", valueInputOption: "USER_ENTERED", requestBody: { values: [recordToRow(PAYMENT_HEADERS, payment)] } });
}

export async function updatePayment(payment: PaymentRecord): Promise<void> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  const rows = await listPayments();
  const index = rows.findIndex((row) => row.payment_id === payment.payment_id);
  if (index === -1) throw new Error("Payment not found");
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `Payments!A${index + 2}:AD${index + 2}`, valueInputOption: "USER_ENTERED", requestBody: { values: [recordToRow(PAYMENT_HEADERS, payment)] } });
}

export async function appendAudit(record: { paymentId: string; clientId: string; action: string; previousStatus: string; newStatus: string; reason: string; source: string; metadata?: string }): Promise<void> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  await sheets.spreadsheets.values.append({ spreadsheetId, range: "Audit Log!A:I", valueInputOption: "USER_ENTERED", requestBody: { values: [[new Date().toISOString(), record.paymentId, record.clientId, record.action, record.previousStatus, record.newStatus, record.reason, record.source, record.metadata ?? ""]] } });
}

export async function reconcileManualConfirmations(): Promise<number> {
  const payments = await listPayments();
  let reconciled = 0;
  for (const payment of payments) {
    if (!needsManualConfirmationAudit(payment)) continue;
    const timestamp = new Date().toISOString();
    await updatePayment({ ...payment, manual_confirmed_at: timestamp, updated_at: timestamp });
    await appendAudit({ paymentId: payment.payment_id, clientId: payment.client_id, action: "MANUAL_CONFIRMED", previousStatus: "REVIEW_OR_FLAGGED", newStatus: "MANUAL_CONFIRMED", reason: "Spreadsheet manual override reconciled", source: "CRON_RECONCILIATION" });
    reconciled += 1;
  }
  return reconciled;
}
