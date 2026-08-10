import { getGoogleSheets } from "./client";
import { CLIENT_HEADERS, rowToRecord, type RowRecord } from "./records";

export type ClientRecord = RowRecord & { client_id: string; active: string; client_name: string; default_amount_thb: string; billing_frequency: string; next_due_date: string };

export async function listClients(): Promise<ClientRecord[]> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Clients!A:J" });
  return (response.data.values ?? []).slice(1).filter((row) => row[0]).map((row) => rowToRecord(CLIENT_HEADERS, row) as ClientRecord);
}
