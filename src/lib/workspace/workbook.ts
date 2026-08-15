import type { sheets_v4 } from "googleapis";
import { AUDIT_HEADERS, CLIENT_HEADERS, PAYMENT_HEADERS, SCHEDULE_HEADERS, sheetColumnName } from "@/lib/sheets/records";
import { getPendingGoogleSheets } from "@/lib/sheets/client";
import { savePendingWorkspaceConnection } from "./connection";
import type { PendingGoogleWorkspaceConnection } from "./types";
import { DEFAULT_LINE_DUE_PROFILES, LINE_DUE_PROFILE_SETTING_KEYS } from "@/lib/line/message-profile";
import { DEFAULT_LINE_WELCOME_TEMPLATE } from "@/lib/line/message-template";

export const OPERATIONAL_WORKBOOK_NAME = "Coaching Payments - Automated";
const TAB_TITLES = ["Clients", "Installment Schedule", "Payments", "Settings", "Audit Log"] as const;
const PACKAGE_HEADERS = ["package_name", "total_price_thb", "payment_type", "installment_count", "interval_months", "active"] as const;
const DEFAULT_SETTING_ROWS = [
  ["business_display_name", "Coaching Payments"],
  ["slip_retention_days", "30"],
  ["ocr_enabled", "true"],
  ["line_linking_enabled", "false"],
  ["line_messaging_enabled", "false"],
  ["line_chat_payments_enabled", "false"],
  [LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME, JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME)],
  [LINE_DUE_PROFILE_SETTING_KEYS.INSTALLMENTS, JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS)],
  ["line_welcome_message_template", DEFAULT_LINE_WELCOME_TEMPLATE],
] as const;
const HEADER_WRITES: sheets_v4.Schema$ValueRange[] = [
  { range: "Clients!A1:AA1", values: [[...CLIENT_HEADERS]] },
  { range: `Installment Schedule!A1:${sheetColumnName(SCHEDULE_HEADERS.length)}1`, values: [[...SCHEDULE_HEADERS]] },
  { range: `Payments!A1:${sheetColumnName(PAYMENT_HEADERS.length)}1`, values: [[...PAYMENT_HEADERS]] },
  { range: "Settings!A1:B1", values: [["key", "value"]] },
  { range: "Settings!D3:I3", values: [[...PACKAGE_HEADERS]] },
  { range: "Audit Log!A1:I1", values: [[...AUDIT_HEADERS]] },
];
const INITIAL_WRITES: sheets_v4.Schema$ValueRange[] = [
  ...HEADER_WRITES.slice(0, 4),
  { range: "Settings!A2:B10", values: DEFAULT_SETTING_ROWS.map((row) => [...row]) },
  ...HEADER_WRITES.slice(4),
];

type ProvisionInput = {
  authorization?: PendingGoogleWorkspaceConnection;
  sheets?: sheets_v4.Sheets;
};

type ProvisionedWorkbook = Required<Pick<PendingGoogleWorkspaceConnection, "spreadsheetId" | "spreadsheetName" | "spreadsheetUrl">>;

function sameRow(actual: unknown[] | undefined, expected: readonly string[]): boolean {
  return Boolean(actual && actual.length >= expected.length && expected.every((value, index) => String(actual[index] ?? "") === value));
}

export async function validateOperationalWorkbook(spreadsheetId: string, sheets: sheets_v4.Sheets): Promise<ProvisionedWorkbook> {
  const [metadata, headers] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId, fields: "spreadsheetId,spreadsheetUrl,properties(title,timeZone),sheets(properties(title))" }),
    sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: HEADER_WRITES.map((item) => item.range!).filter(Boolean) }),
  ]);
  const titles = metadata.data.sheets?.map((sheet) => sheet.properties?.title ?? "") ?? [];
  if (metadata.data.properties?.timeZone !== "Asia/Bangkok" || titles.length !== TAB_TITLES.length || TAB_TITLES.some((title, index) => titles[index] !== title)) {
    throw new Error("Operational workbook schema is invalid.");
  }
  const expectedRows = [[...CLIENT_HEADERS], [...SCHEDULE_HEADERS], [...PAYMENT_HEADERS], ["key", "value"], [...PACKAGE_HEADERS], [...AUDIT_HEADERS]];
  if (expectedRows.some((expected, index) => !sameRow(headers.data.valueRanges?.[index]?.values?.[0], expected))) {
    throw new Error("Operational workbook headers are invalid.");
  }
  return {
    spreadsheetId,
    spreadsheetName: metadata.data.properties?.title ?? OPERATIONAL_WORKBOOK_NAME,
    spreadsheetUrl: metadata.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

function formatRequests(sheetIds: Record<string, number>): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];
  for (const [title, sheetId] of Object.entries(sheetIds)) {
    const headerRow = title === "Settings" ? 3 : 1;
    requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: title === "Settings" ? 3 : 1 } }, fields: "gridProperties.frozenRowCount" } });
    requests.push({ repeatCell: { range: { sheetId, startRowIndex: headerRow - 1, endRowIndex: headerRow }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } });
    if (title !== "Settings") requests.push({ setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0 } } } });
  }
  const numberFormat = (sheetId: number, startColumnIndex: number, type: "DATE" | "NUMBER", pattern: string): sheets_v4.Schema$Request => ({
    repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex, endColumnIndex: startColumnIndex + 1 }, cell: { userEnteredFormat: { numberFormat: { type, pattern } } }, fields: "userEnteredFormat.numberFormat" },
  });
  requests.push(numberFormat(sheetIds.Clients, 7, "NUMBER", "฿#,##0.00"), numberFormat(sheetIds.Clients, 9, "DATE", "yyyy-mm-dd"));
  requests.push(numberFormat(sheetIds["Installment Schedule"], 9, "NUMBER", "฿#,##0.00"), numberFormat(sheetIds["Installment Schedule"], 10, "DATE", "yyyy-mm-dd"));
  requests.push(numberFormat(sheetIds.Payments, 4, "NUMBER", "฿#,##0.00"), numberFormat(sheetIds.Payments, 5, "DATE", "yyyy-mm-dd"));
  return requests;
}

async function initializeOperationalWorkbook(
  spreadsheetId: string,
  sheets: sheets_v4.Sheets,
  sheetIds?: Record<string, number>,
  includeDefaultSettings = false,
): Promise<void> {
  let resolvedSheetIds = sheetIds;
  if (!resolvedSheetIds) {
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties(timeZone),sheets(properties(sheetId,title))",
    });
    const titles = metadata.data.sheets?.map((sheet) => sheet.properties?.title ?? "") ?? [];
    if (metadata.data.properties?.timeZone !== "Asia/Bangkok" || titles.length !== TAB_TITLES.length || TAB_TITLES.some((title, index) => titles[index] !== title)) {
      throw new Error("Operational workbook schema is invalid.");
    }
    resolvedSheetIds = Object.fromEntries((metadata.data.sheets ?? []).flatMap((sheet) => {
      const title = sheet.properties?.title;
      const sheetId = sheet.properties?.sheetId;
      return title && sheetId !== undefined && sheetId !== null ? [[title, sheetId]] : [];
    }));
  }
  if (TAB_TITLES.some((title) => resolvedSheetIds?.[title] === undefined)) throw new Error("New workbook tabs could not be formatted.");
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: includeDefaultSettings ? INITIAL_WRITES : HEADER_WRITES },
  });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: formatRequests(resolvedSheetIds) } });
}

export async function provisionOperationalWorkbook(input: ProvisionInput = {}): Promise<ProvisionedWorkbook> {
  const staged = input.authorization && input.sheets ? { connection: input.authorization, sheets: input.sheets } : await getPendingGoogleSheets();
  const { connection, sheets } = staged;
  if (connection.spreadsheetId) {
    try {
      return await validateOperationalWorkbook(connection.spreadsheetId, sheets);
    } catch {
      await initializeOperationalWorkbook(connection.spreadsheetId, sheets);
      return validateOperationalWorkbook(connection.spreadsheetId, sheets);
    }
  }

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: OPERATIONAL_WORKBOOK_NAME, timeZone: "Asia/Bangkok" },
      sheets: TAB_TITLES.map((title) => ({ properties: { title } })),
    },
  });
  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) throw new Error("Google did not return the new workbook ID.");
  const spreadsheetName = created.data.properties?.title ?? OPERATIONAL_WORKBOOK_NAME;
  const spreadsheetUrl = created.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  await savePendingWorkspaceConnection({ ...connection, spreadsheetId, spreadsheetName, spreadsheetUrl });
  const sheetIds = Object.fromEntries((created.data.sheets ?? []).flatMap((sheet) => {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    return title && sheetId !== undefined && sheetId !== null ? [[title, sheetId]] : [];
  }));
  await initializeOperationalWorkbook(spreadsheetId, sheets, sheetIds, true);
  return validateOperationalWorkbook(spreadsheetId, sheets);
}
