import { createHash } from "node:crypto";
import { isLineReservationConflict, lineReservationName } from "@/lib/line/connection-reservation";
import { getGoogleSheets } from "./client";
import { ensureClientSchema } from "./migration";
import { CLIENT_HEADERS, firstEmptyIdRow, recordToRow, rowToRecord, sheetColumnName } from "./records";

type LineConnectionFields = { line_link_status: string; line_linked_at: string; line_link_error: string; line_link_token_hash: string; line_link_token_encrypted: string; line_link_token_expires_at: string };
export type ClientRecord = { rowNumber: number; client_id: string; active: string; client_name: string; line_user_id: string; line_display_name: string; line_picture_url: string; package_name: string; payment_type: string; total_price_thb: string; installment_count: string; interval_months: string; first_due_date: string; default_amount_thb: string; billing_frequency: string; next_due_date: string; notes: string; created_at: string; updated_at: string } & LineConnectionFields;
export type NewClientRecord = Omit<ClientRecord, "rowNumber" | keyof LineConnectionFields> & Partial<LineConnectionFields>;
export type LineConnectionClaimInput = { client: ClientRecord; expectedClient: ClientRecord; tokenHash: string; lineUserId: string };
export type LineConnectionClaimResult = "CLAIMED" | "ALREADY_LINKED" | "CONFLICT" | "STALE";
export type LineLinkUpdateInput = { client: ClientRecord; expectedClient: ClientRecord; releaseLineUserId?: string };

const CLIENT_END_COLUMN = sheetColumnName(CLIENT_HEADERS.length);

function lineStateReservationName(client: ClientRecord): string {
  const state = [client.client_id, client.active, client.line_user_id, client.line_display_name, client.line_picture_url, client.line_link_status, client.line_linked_at, client.line_link_error, client.line_link_token_hash, client.line_link_token_encrypted, client.line_link_token_expires_at, client.updated_at];
  return `line_link_state_${createHash("sha256").update(JSON.stringify(state)).digest("hex")}`;
}

function claimCell(value: string) {
  return { userEnteredValue: { stringValue: value } };
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
    { updateCells: { range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 16, endColumnIndex: 23 }, rows: [{ values: [claimCell(client.updated_at), claimCell(client.line_link_status), claimCell(client.line_linked_at), claimCell(client.line_link_error), claimCell(client.line_link_token_hash), claimCell(client.line_link_token_encrypted), claimCell(client.line_link_token_expires_at)] }], fields: "userEnteredValue" } },
    { updateCells: { range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 23, endColumnIndex: 24 }, rows: [{ values: [claimCell(client.line_picture_url)] }], fields: "userEnteredValue" } },
  ];
}

export async function listClients(): Promise<ClientRecord[]> {
  await ensureClientSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `Clients!A:${CLIENT_END_COLUMN}` });
  return (response.data.values ?? []).slice(1).map((row, index) => ({ ...rowToRecord(CLIENT_HEADERS, row), rowNumber: index + 2 }) as ClientRecord).filter((row) => row.client_id);
}

/** Writes to the first physical blank ID row, avoiding append-only sheet bloat. */
export async function writeClient(client: NewClientRecord): Promise<void> {
  await ensureClientSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `Clients!A:${CLIENT_END_COLUMN}` });
  const rowNumber = firstEmptyIdRow((response.data.values ?? []).slice(1));
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Clients!A${rowNumber}:${CLIENT_END_COLUMN}${rowNumber}`,
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
    range: `Clients!A${client.rowNumber}:${CLIENT_END_COLUMN}${client.rowNumber}`,
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
    if (isLineReservationConflict(error)) return false;
    throw error;
  }
}

/** Atomically reserves hashed connection token and verified LINE user. */
export async function claimLineConnection({ client, expectedClient, tokenHash, lineUserId }: LineConnectionClaimInput): Promise<LineConnectionClaimResult> {
  if (!Number.isInteger(client.rowNumber) || client.rowNumber < 2) throw new Error("Client physical row is required");
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error("LINE connection token hash is malformed");
  await ensureClientSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const sheetId = await clientSheetId();
  const rowStart = client.rowNumber - 1;
  const reservationRange = { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 0, endColumnIndex: 1 };

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [
        { addNamedRange: { namedRange: { name: lineStateReservationName(expectedClient), range: reservationRange } } },
        { addNamedRange: { namedRange: { name: lineReservationName("token", tokenHash), range: reservationRange } } },
        { addNamedRange: { namedRange: { name: lineReservationName("user", lineUserId), range: reservationRange } } },
        ...lineLinkCellUpdates(client, sheetId),
      ] },
    });
    return "CLAIMED";
  } catch (error) {
    if (!isLineReservationConflict(error)) throw error;
    const clients = await listClients();
    if (clients.some((item) => item.client_id === client.client_id && item.line_user_id === lineUserId && item.line_link_token_hash === tokenHash)) return "ALREADY_LINKED";
    if (clients.some((item) => item.line_user_id === lineUserId || (item.line_link_token_hash === tokenHash && item.line_user_id))) return "CONFLICT";
    return "STALE";
  }
}
