export const CLIENT_HEADERS = ["client_id", "active", "client_name", "line_display_name", "default_amount_thb", "billing_frequency", "next_due_date", "notes", "created_at", "updated_at"] as const;
export const PAYMENT_HEADERS = ["payment_id", "client_id", "client_name", "period", "amount_thb", "due_date", "public_token", "payment_url", "status", "created_at", "submitted_at", "recorded_at", "manual_confirmed_at", "transaction_ref", "originating_bank", "slip_hash", "qr_valid", "ocr_amount", "amount_match", "ocr_receiver", "receiver_match", "ocr_transaction_date", "date_match", "check_score", "review_reason", "slip_url", "admin_notes", "line_message", "updated_at", "qr_payload_hash"] as const;
export const AUDIT_HEADERS = ["timestamp", "payment_id", "client_id", "action", "previous_status", "new_status", "reason", "source", "metadata"] as const;

export type RowRecord = Record<string, string>;

export function rowToRecord(headers: readonly string[], values: readonly unknown[]): RowRecord {
  return Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "")]));
}

export function recordToRow(headers: readonly string[], record: RowRecord): string[] {
  return headers.map((header) => record[header] ?? "");
}
