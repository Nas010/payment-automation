import { getGoogleSheets } from "./client";
import { CLIENT_HEADERS, firstEmptyIdRow, recordToRow, rowToRecord } from "./records";

export type ClientRecord = { rowNumber: number; client_id: string; active: string; client_name: string; line_user_id: string; line_display_name: string; package_name: string; payment_type: string; total_price_thb: string; installment_count: string; interval_months: string; first_due_date: string; default_amount_thb: string; billing_frequency: string; next_due_date: string; notes: string; created_at: string; updated_at: string };
export type NewClientRecord = Omit<ClientRecord, "rowNumber">;

export async function listClients(): Promise<ClientRecord[]> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Clients!A:Q" });
  return (response.data.values ?? []).slice(1).map((row, index) => ({ ...rowToRecord(CLIENT_HEADERS, row), rowNumber: index + 2 }) as ClientRecord).filter((row) => row.client_id);
}

/** Writes to the first physical blank ID row, avoiding append-only sheet bloat. */
export async function writeClient(client: NewClientRecord): Promise<void> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Clients!A:Q" });
  const rowNumber = firstEmptyIdRow((response.data.values ?? []).slice(1));
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Clients!A${rowNumber}:Q${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [recordToRow(CLIENT_HEADERS, client)] },
  });
}

export async function updateClient(client: ClientRecord): Promise<void> {
  if (!Number.isInteger(client.rowNumber) || client.rowNumber < 2) throw new Error("Client physical row is required");
  const { sheets, spreadsheetId } = getGoogleSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Clients!A${client.rowNumber}:Q${client.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [recordToRow(CLIENT_HEADERS, client)] },
  });
}
