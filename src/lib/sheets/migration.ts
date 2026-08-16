import { getGoogleSheets } from "./client";
import { CLIENT_HEADERS, PAYMENT_HEADERS, SCHEDULE_HEADERS, sheetColumnName } from "./records";

const LEGACY_CLIENT_HEADERS = ["line_link_code", "line_link_code_expires_at", "line_link_message"] as const;
const LEGACY_CLIENT_END_COLUMN = "AA";

/** Adds blank header cells without replacing any existing workbook values. */
async function ensureSheetSchema(title: string, headers: readonly string[], firstHeaderToFill = 0): Promise<void> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title,gridProperties(columnCount)))" });
  const sheet = metadata.data.sheets?.find((item) => item.properties?.title === title);
  const properties = sheet?.properties;
  const sheetId = properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error(`${title} sheet is required`);
  const columnCount = properties?.gridProperties?.columnCount ?? 0;
  if (columnCount < headers.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ appendDimension: { sheetId, dimension: "COLUMNS", length: headers.length - columnCount } }] },
    });
  }
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!A1:${sheetColumnName(headers.length)}1` });
  const currentHeaders = response.data.values?.[0] ?? [];

  await Promise.all(headers.map(async (header, index) => {
    if (index < firstHeaderToFill || String(currentHeaders[index] ?? "").trim()) return;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!${sheetColumnName(index + 1)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[header]] },
    });
  }));
}

let clientSchemaCheck: Promise<void> | null = null;
let paymentSchemaCheck: Promise<void> | null = null;
let scheduleSchemaCheck: Promise<void> | null = null;

async function ensureLiffOnlyClientSchema(): Promise<void> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title,gridProperties(columnCount))),namedRanges(namedRangeId,name)" });
  const properties = metadata.data.sheets?.find((item) => item.properties?.title === "Clients")?.properties;
  const sheetId = properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error("Clients sheet is required");
  const columnCount = properties?.gridProperties?.columnCount ?? 0;
  if (columnCount < 27) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ appendDimension: { sheetId, dimension: "COLUMNS", length: 27 - columnCount } }] },
    });
  }

  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `Clients!A1:${LEGACY_CLIENT_END_COLUMN}1` });
  const currentHeaders = response.data.values?.[0] ?? [];
  const legacyIndices = currentHeaders
    .map((header, index) => LEGACY_CLIENT_HEADERS.includes(String(header).trim() as typeof LEGACY_CLIENT_HEADERS[number]) ? index : -1)
    .filter((index) => index >= 0)
    .sort((left, right) => right - left);
  const staleCodeRanges = (metadata.data.namedRanges ?? []).filter((range) => range.name?.startsWith("line_link_code_") && range.namedRangeId);
  const cleanupRequests = [
    ...legacyIndices.map((index) => ({ deleteDimension: { range: { sheetId, dimension: "COLUMNS" as const, startIndex: index, endIndex: index + 1 } } })),
    ...staleCodeRanges.map((range) => ({ deleteNamedRange: { namedRangeId: range.namedRangeId! } })),
  ];
  if (cleanupRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: cleanupRequests } });
  }

  const migratedHeaders = currentHeaders.filter((_header, index) => !legacyIndices.includes(index));
  await Promise.all(CLIENT_HEADERS.map(async (header, index) => {
    if (String(migratedHeaders[index] ?? "").trim()) return;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Clients!${sheetColumnName(index + 1)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[header]] },
    });
  }));
}

/** Removes legacy link-code columns and ensures LIFF-only headers once per warm process. */
export function ensureClientSchema(): Promise<void> {
  if (clientSchemaCheck) return clientSchemaCheck;
  const cached = ensureLiffOnlyClientSchema().catch((error) => {
    if (clientSchemaCheck === cached) clientSchemaCheck = null;
    throw error;
  });
  clientSchemaCheck = cached;
  return cached;
}

/** Extends legacy payment sheets once per warm process and fills blank appended LINE headers. */
export function ensurePaymentSchema(): Promise<void> {
  if (paymentSchemaCheck) return paymentSchemaCheck;
  const cached = ensureSheetSchema("Payments", PAYMENT_HEADERS, 30).catch((error) => {
    if (paymentSchemaCheck === cached) paymentSchemaCheck = null;
    throw error;
  });
  paymentSchemaCheck = cached;
  return cached;
}

/** Extends legacy schedule sheets once per warm process with assignment metadata columns. */
export function ensureScheduleSchema(): Promise<void> {
  if (scheduleSchemaCheck) return scheduleSchemaCheck;
  const cached = ensureSheetSchema("Installment Schedule", SCHEDULE_HEADERS).catch((error) => {
    if (scheduleSchemaCheck === cached) scheduleSchemaCheck = null;
    throw error;
  });
  scheduleSchemaCheck = cached;
  return cached;
}
