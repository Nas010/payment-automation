import { getGoogleSheets } from "./client";
import { CLIENT_HEADERS } from "./records";

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

/** Adds blank client header cells without replacing any existing workbook values. */
export async function ensureClientSchema(): Promise<void> {
  const { sheets, spreadsheetId } = getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Clients!A1:W1" });
  const headers = response.data.values?.[0] ?? [];

  await Promise.all(CLIENT_HEADERS.map(async (header, index) => {
    if (String(headers[index] ?? "").trim()) return;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Clients!${columnName(index + 1)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[header]] },
    });
  }));
}
