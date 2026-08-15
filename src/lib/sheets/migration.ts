import { getGoogleSheets } from "./client";
import { CLIENT_HEADERS, PAYMENT_HEADERS, sheetColumnName } from "./records";

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

/** Adds blank client header cells once per warm process without replacing existing values. */
export function ensureClientSchema(): Promise<void> {
  if (clientSchemaCheck) return clientSchemaCheck;
  const cached = ensureSheetSchema("Clients", CLIENT_HEADERS).catch((error) => {
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
