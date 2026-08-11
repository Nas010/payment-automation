import { getGoogleSheets } from "./client";
import { AUDIT_HEADERS, rowToRecord, type RowRecord } from "./records";

export type AuditRecord = RowRecord & { rowNumber: number; timestamp: string; payment_id: string; client_id: string; action: string; previous_status: string; new_status: string; reason: string; source: string; metadata: string };
export type LineAuditEventIdentity = { paymentId: string; action: string; requestId: string };
export type PaymentTransitionAuditIdentity = { paymentId: string; action: string; source: string; scheduleId: string };

export async function listAuditRecords(): Promise<AuditRecord[]> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Audit Log!A:I" });
  return (response.data.values ?? []).slice(1).map((row, index) => ({ ...rowToRecord(AUDIT_HEADERS, row), rowNumber: index + 2 }) as AuditRecord).filter((item) => item.timestamp).reverse();
}

function auditRequestCode(metadata: string): string {
  try {
    const parsed: unknown = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && typeof (parsed as { requestCode?: unknown }).requestCode === "string"
      ? (parsed as { requestCode: string }).requestCode
      : "";
  } catch {
    return "";
  }
}

/** Checks deterministic LINE audit identity without comparing free-form reason or remote response text. */
export async function hasLineAuditEvent(identity: LineAuditEventIdentity): Promise<boolean> {
  return (await listAuditRecords()).some((record) => record.payment_id === identity.paymentId
    && record.action === identity.action
    && auditRequestCode(record.metadata) === identity.requestId);
}

function auditScheduleId(metadata: string): string {
  try {
    const parsed: unknown = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && typeof (parsed as { scheduleId?: unknown }).scheduleId === "string"
      ? (parsed as { scheduleId: string }).scheduleId
      : "";
  } catch {
    return "";
  }
}

/** Checks a terminal transition audit by its stable payment, action, source, and schedule identity. */
export async function hasPaymentTransitionAudit(identity: PaymentTransitionAuditIdentity): Promise<boolean> {
  return (await listAuditRecords()).some((record) => record.payment_id === identity.paymentId
    && record.action === identity.action
    && record.source === identity.source
    && auditScheduleId(record.metadata) === identity.scheduleId);
}
