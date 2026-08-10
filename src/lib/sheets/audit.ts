import { getGoogleSheets } from "./client";
import { AUDIT_HEADERS, rowToRecord, type RowRecord } from "./records";

export type AuditRecord = RowRecord & { rowNumber: number; timestamp: string; payment_id: string; client_id: string; action: string; previous_status: string; new_status: string; reason: string; source: string; metadata: string };

export async function listAuditRecords(): Promise<AuditRecord[]> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Audit Log!A:I" });
  return (response.data.values ?? []).slice(1).map((row, index) => ({ ...rowToRecord(AUDIT_HEADERS, row), rowNumber: index + 2 }) as AuditRecord).filter((item) => item.timestamp).reverse();
}
