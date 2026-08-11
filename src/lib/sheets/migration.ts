import { getGoogleSheets } from "./client";
import { CLIENT_HEADERS, PAYMENT_HEADERS } from "./records";

function columnName(column: number): string {
  let value = column;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

/** Adds blank header cells without replacing any existing workbook values. */
async function ensureSheetSchema(title: string, headers: readonly string[], firstHeaderToFill = 0): Promise<void> {
  const { sheets, spreadsheetId } = getGoogleSheets();
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
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!A1:${columnName(headers.length)}1` });
  const currentHeaders = response.data.values?.[0] ?? [];

  await Promise.all(headers.map(async (header, index) => {
    if (index < firstHeaderToFill || String(currentHeaders[index] ?? "").trim()) return;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!${columnName(index + 1)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[header]] },
    });
  }));
}

/** Adds blank client header cells without replacing any existing workbook values. */
export async function ensureClientSchema(): Promise<void> {
  await ensureSheetSchema("Clients", CLIENT_HEADERS);
}

/** Extends legacy payment sheets and fills blank appended LINE transport headers only. */
export async function ensurePaymentSchema(): Promise<void> {
  await ensureSheetSchema("Payments", PAYMENT_HEADERS, 30);
}
