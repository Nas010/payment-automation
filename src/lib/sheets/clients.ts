import { getGoogleSheets } from "./client";
import { ensureClientSchema } from "./migration";
import { CLIENT_HEADERS, firstEmptyIdRow, recordToRow, rowToRecord } from "./records";

type LineLinkFields = { line_link_code: string; line_link_code_expires_at: string; line_link_status: string; line_linked_at: string; line_link_message: string; line_link_error: string };
export type ClientRecord = { rowNumber: number; client_id: string; active: string; client_name: string; line_user_id: string; line_display_name: string; package_name: string; payment_type: string; total_price_thb: string; installment_count: string; interval_months: string; first_due_date: string; default_amount_thb: string; billing_frequency: string; next_due_date: string; notes: string; created_at: string; updated_at: string } & LineLinkFields;
export type NewClientRecord = Omit<ClientRecord, "rowNumber" | keyof LineLinkFields> & Partial<LineLinkFields>;

export async function listClients(): Promise<ClientRecord[]> {
  await ensureClientSchema();
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Clients!A:W" });
  return (response.data.values ?? []).slice(1).map((row, index) => ({ ...rowToRecord(CLIENT_HEADERS, row), rowNumber: index + 2 }) as ClientRecord).filter((row) => row.client_id);
}

/** Writes to the first physical blank ID row, avoiding append-only sheet bloat. */
export async function writeClient(client: NewClientRecord): Promise<void> {
  await ensureClientSchema();
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Clients!A:W" });
  const rowNumber = firstEmptyIdRow((response.data.values ?? []).slice(1));
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Clients!A${rowNumber}:W${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [recordToRow(CLIENT_HEADERS, client)] },
  });
}

export async function updateClient(client: ClientRecord): Promise<void> {
  if (!Number.isInteger(client.rowNumber) || client.rowNumber < 2) throw new Error("Client physical row is required");
  await ensureClientSchema();
  const { sheets, spreadsheetId } = getGoogleSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Clients!A${client.rowNumber}:W${client.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [recordToRow(CLIENT_HEADERS, client)] },
  });
}
