export const CLIENT_HEADERS = ["client_id", "active", "client_name", "line_user_id", "line_display_name", "package_name", "payment_type", "total_price_thb", "installment_count", "interval_months", "first_due_date", "default_amount_thb", "billing_frequency", "next_due_date", "notes", "created_at", "updated_at", "line_link_code", "line_link_code_expires_at", "line_link_status", "line_linked_at", "line_link_message", "line_link_error", "line_link_token_hash", "line_link_token_encrypted", "line_link_token_expires_at", "line_picture_url"] as const;
export const PAYMENT_HEADERS = ["payment_id", "client_id", "client_name", "period", "amount_thb", "due_date", "public_token", "payment_url", "status", "created_at", "submitted_at", "recorded_at", "manual_confirmed_at", "transaction_ref", "originating_bank", "slip_hash", "qr_valid", "ocr_amount", "amount_match", "ocr_receiver", "receiver_match", "ocr_transaction_date", "date_match", "check_score", "review_reason", "slip_url", "admin_notes", "line_message", "updated_at", "qr_payload_hash", "line_message_status", "line_retry_key", "line_message_attempted_at", "line_message_sent_at", "line_request_id", "line_message_error", "line_payment_requested_at", "line_slip_expected", "line_slip_received_at", "line_source_message_id", "line_slip_processing_status", "line_slip_error", "line_reply_status", "line_reply_at", "package_name", "payment_type", "installment_number", "installment_count", "total_price_thb", "line_terms_image_token"] as const;
export const SCHEDULE_HEADERS = ["schedule_id", "client_id", "client_name", "line_user_id", "line_display_name", "package_name", "payment_type", "installment_number", "installment_count", "amount_thb", "due_date", "status", "generated_at", "payment_id", "payment_url", "notes", "created_at", "updated_at"] as const;
export const AUDIT_HEADERS = ["timestamp", "payment_id", "client_id", "action", "previous_status", "new_status", "reason", "source", "metadata"] as const;

export type RowRecord = Record<string, string>;

export function sheetColumnName(column: number): string {
  let value = column;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

export function rowToRecord(headers: readonly string[], values: readonly unknown[]): RowRecord {
  return Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "")]));
}

export function recordToRow(headers: readonly string[], record: object): string[] {
  const values = record as Record<string, unknown>;
  return headers.map((header) => String(values[header] ?? ""));
}

/** Returns the one-based sheet row for the first record with no primary ID. */
export function firstEmptyIdRow(rows: readonly (readonly unknown[])[], firstDataRow = 2): number {
  const emptyIndex = rows.findIndex((row) => !String(row[0] ?? "").trim());
  return emptyIndex === -1 ? firstDataRow + rows.length : firstDataRow + emptyIndex;
}
