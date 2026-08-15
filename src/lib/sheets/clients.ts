import { createHash } from "node:crypto";
import { getGoogleSheets } from "./client";
import { ensureClientSchema } from "./migration";
import { CLIENT_HEADERS, firstEmptyIdRow, recordToRow, rowToRecord } from "./records";

type LineLinkFields = { line_link_code: string; line_link_code_expires_at: string; line_link_status: string; line_linked_at: string; line_link_message: string; line_link_error: string };
export type ClientRecord = { rowNumber: number; client_id: string; active: string; client_name: string; line_user_id: string; line_display_name: string; package_name: string; payment_type: string; total_price_thb: string; installment_count: string; interval_months: string; first_due_date: string; default_amount_thb: string; billing_frequency: string; next_due_date: string; notes: string; created_at: string; updated_at: string } & LineLinkFields;
export type NewClientRecord = Omit<ClientRecord, "rowNumber" | keyof LineLinkFields> & Partial<LineLinkFields>;
export type LineLinkClaimInput = { client: ClientRecord; expectedClient: ClientRecord; code: string; lineUserId: string };
export type LineLinkClaimResult = "CLAIMED" | "ALREADY_LINKED" | "CONFLICT" | "STALE";
export type LineLinkUpdateInput = { client: ClientRecord; expectedClient: ClientRecord; releaseLineUserId?: string };

function lineReservationName(kind: "code" | "user", value: string): string {
  return `line_link_${kind}_${createHash("sha256").update(value).digest("hex")}`;
}

function lineStateReservationName(client: ClientRecord): string {
  const state = [client.client_id, client.active, client.line_user_id, client.line_display_name, client.line_link_code, client.line_link_code_expires_at, client.line_link_status, client.line_linked_at, client.line_link_message, client.line_link_error, client.updated_at];
  return `line_link_state_${createHash("sha256").update(JSON.stringify(state)).digest("hex")}`;
}

function claimCell(value: string) {
  return { userEnteredValue: { stringValue: value } };
}

function isReservationConflict(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "response" in error
    ? (error as { response?: { status?: unknown } }).response?.status
    : undefined;
  const message = error instanceof Error ? error.message : "";
  return status === 400 && /named range.*already exists/i.test(message);
}

async function clientSheetMetadata(): Promise<{ sheetId: number; namedRanges: Array<{ name?: string | null; namedRangeId?: string | null }> }> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title)),namedRanges(namedRangeId,name)" });
  const sheetId = response.data.sheets?.find((sheet) => sheet.properties?.title === "Clients")?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error("Clients sheet is required");
  return { sheetId, namedRanges: response.data.namedRanges ?? [] };
}

async function clientSheetId(): Promise<number> {
  return (await clientSheetMetadata()).sheetId;
}

function lineLinkCellUpdates(client: ClientRecord, sheetId: number) {
  const rowStart = client.rowNumber - 1;
  return [
    { updateCells: { range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 3, endColumnIndex: 5 }, rows: [{ values: [claimCell(client.line_user_id), claimCell(client.line_display_name)] }], fields: "userEnteredValue" } },
    { updateCells: { range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 16, endColumnIndex: 23 }, rows: [{ values: [claimCell(client.updated_at), claimCell(client.line_link_code), claimCell(client.line_link_code_expires_at), claimCell(client.line_link_status), claimCell(client.line_linked_at), claimCell(client.line_link_message), claimCell(client.line_link_error)] }], fields: "userEnteredValue" } },
  ];
}

export async function listClients(): Promise<ClientRecord[]> {
  await ensureClientSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Clients!A:W" });
  return (response.data.values ?? []).slice(1).map((row, index) => ({ ...rowToRecord(CLIENT_HEADERS, row), rowNumber: index + 2 }) as ClientRecord).filter((row) => row.client_id);
}

/** Writes to the first physical blank ID row, avoiding append-only sheet bloat. */
export async function writeClient(client: NewClientRecord): Promise<void> {
  await ensureClientSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
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
  const { sheets, spreadsheetId } = await getGoogleSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Clients!A${client.rowNumber}:W${client.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [recordToRow(CLIENT_HEADERS, client)] },
  });
}

/** Atomically updates LINE-link fields only when expected link state is still current. */
export async function updateLineLinkClient({ client, expectedClient, releaseLineUserId }: LineLinkUpdateInput): Promise<boolean> {
  if (!Number.isInteger(client.rowNumber) || client.rowNumber < 2) throw new Error("Client physical row is required");
  await ensureClientSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const { sheetId, namedRanges } = await clientSheetMetadata();
  const rowStart = client.rowNumber - 1;
  const reservationRange = { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 0, endColumnIndex: 1 };
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [
        { addNamedRange: { namedRange: { name: lineStateReservationName(expectedClient), range: reservationRange } } },
        ...lineLinkCellUpdates(client, sheetId),
        ...(releaseLineUserId ? namedRanges.filter((namedRange) => namedRange.name === lineReservationName("user", releaseLineUserId) && namedRange.namedRangeId !== undefined && namedRange.namedRangeId !== null).map((namedRange) => ({ deleteNamedRange: { namedRangeId: namedRange.namedRangeId } })) : []),
      ] },
    });
    return true;
  } catch (error) {
    if (isReservationConflict(error)) return false;
    throw error;
  }
}

/**
 * Atomically reserves both code and LINE user before writing link fields.
 * Named-range creation is conditional at the Sheets API boundary: duplicate
 * names reject the whole batch, including the client-row update.
 */
export async function claimLineLink({ client, expectedClient, code, lineUserId }: LineLinkClaimInput): Promise<LineLinkClaimResult> {
  if (!Number.isInteger(client.rowNumber) || client.rowNumber < 2) throw new Error("Client physical row is required");
  await ensureClientSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const sheetId = await clientSheetId();
  const rowStart = client.rowNumber - 1;
  const reservationRange = { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 0, endColumnIndex: 1 };

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { addNamedRange: { namedRange: { name: lineStateReservationName(expectedClient), range: reservationRange } } },
          { addNamedRange: { namedRange: { name: lineReservationName("code", code), range: reservationRange } } },
          { addNamedRange: { namedRange: { name: lineReservationName("user", lineUserId), range: reservationRange } } },
          ...lineLinkCellUpdates(client, sheetId),
        ],
      },
    });
    return "CLAIMED";
  } catch (error) {
    if (!isReservationConflict(error)) throw error;
    const clients = await listClients();
    if (clients.some((item) => item.client_id === client.client_id && item.line_user_id === lineUserId && item.line_link_status === "LINKED")) return "ALREADY_LINKED";
    if (clients.some((item) => item.line_user_id === lineUserId)) return "CONFLICT";
    return "STALE";
  }
}
