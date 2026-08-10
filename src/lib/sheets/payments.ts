import { getGoogleSheets } from "./client";
import { PAYMENT_HEADERS, recordToRow, rowToRecord } from "./records";
import { needsManualConfirmationAudit } from "@/lib/payments/manual-confirmation";

export type PaymentRecord = { rowNumber: number; payment_id: string; client_id: string; client_name: string; period: string; amount_thb: string; due_date: string; public_token: string; payment_url: string; status: string; created_at: string; submitted_at: string; recorded_at: string; manual_confirmed_at: string; transaction_ref: string; originating_bank: string; slip_hash: string; qr_valid: string; ocr_amount: string; amount_match: string; ocr_receiver: string; receiver_match: string; ocr_transaction_date: string; date_match: string; check_score: string; review_reason: string; slip_url: string; admin_notes: string; line_message: string; updated_at: string; qr_payload_hash: string };
export type NewPaymentRecord = Omit<PaymentRecord, "rowNumber">;

export async function listPayments(): Promise<PaymentRecord[]> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Payments!A:AD" });
  return (response.data.values ?? []).slice(1).map((row, index) => ({ ...rowToRecord(PAYMENT_HEADERS, row), rowNumber: index + 2 }) as PaymentRecord).filter((row) => row.payment_id);
}

export async function getPaymentByToken(token: string): Promise<PaymentRecord | null> {
  return (await listPayments()).find((payment) => payment.public_token === token) ?? null;
}

export async function getPaymentById(paymentId: string): Promise<PaymentRecord | null> {
  return (await listPayments()).find((payment) => payment.payment_id === paymentId) ?? null;
}

export async function appendPayment(payment: NewPaymentRecord): Promise<void> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  await sheets.spreadsheets.values.append({ spreadsheetId, range: "Payments!A:AD", valueInputOption: "USER_ENTERED", requestBody: { values: [recordToRow(PAYMENT_HEADERS, payment)] } });
}

export async function updatePayment(payment: PaymentRecord): Promise<void> {
  if (!Number.isInteger(payment.rowNumber) || payment.rowNumber < 2) throw new Error("Payment physical row is required");
  const { sheets, spreadsheetId } = getGoogleSheets();
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `Payments!A${payment.rowNumber}:AD${payment.rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [recordToRow(PAYMENT_HEADERS, payment)] } });
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
