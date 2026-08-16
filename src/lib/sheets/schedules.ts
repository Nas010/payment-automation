import { createHash } from "node:crypto";
import { getGoogleSheets } from "./client";
import { ensureScheduleSchema } from "./migration";
import { SCHEDULE_HEADERS, firstEmptyIdRow, recordToRow, rowToRecord, sheetColumnName } from "./records";

const SCHEDULE_END_COLUMN = sheetColumnName(SCHEDULE_HEADERS.length);

export type ScheduleRecord = {
  rowNumber: number;
  schedule_id: string;
  client_id: string;
  client_name: string;
  line_user_id: string;
  line_display_name: string;
  package_name: string;
  payment_type: string;
  installment_number: string;
  installment_count: string;
  amount_thb: string;
  due_date: string;
  status: string;
  generated_at: string;
  payment_id: string;
  payment_url: string;
  notes: string;
  created_at: string;
  updated_at: string;
  assignment_id: string;
  assignment_kind: string;
  lifecycle_operation_id?: string;
};

export type NewScheduleRecord = Omit<ScheduleRecord, "rowNumber" | "assignment_id" | "assignment_kind" | "lifecycle_operation_id">
  & Partial<Pick<ScheduleRecord, "assignment_id" | "assignment_kind" | "lifecycle_operation_id">>;

type ScheduleUpdate = { expectedSchedule: ScheduleRecord; schedule: ScheduleRecord };

function scheduleStatePrefix(scheduleId: string): string {
  return `schedule_state_${createHash("sha256").update(scheduleId).digest("hex")}_`;
}

export function scheduleStateTokenName(schedule: ScheduleRecord): string {
  const stateHash = createHash("sha256").update(JSON.stringify(recordToRow(SCHEDULE_HEADERS, schedule))).digest("hex");
  return `${scheduleStatePrefix(schedule.schedule_id)}${stateHash}`;
}

function scheduleStateConflict(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "response" in error
    ? (error as { response?: { status?: unknown } }).response?.status
    : undefined;
  return status === 400 && error instanceof Error && /named range|deletenamedrange/i.test(error.message);
}

async function scheduleSheetMetadata(): Promise<{ sheetId: number; namedRanges: Array<{ name?: string | null; namedRangeId?: string | null }> }> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title)),namedRanges(namedRangeId,name)" });
  const sheetId = response.data.sheets?.find((sheet) => sheet.properties?.title === "Installment Schedule")?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error("Installment Schedule sheet is required");
  return { sheetId, namedRanges: response.data.namedRanges ?? [] };
}

function scheduleCell(value: string) {
  return { userEnteredValue: { stringValue: value } };
}

function scheduleRowRequest(schedule: ScheduleRecord, sheetId: number) {
  const rowStart = schedule.rowNumber - 1;
  return { updateCells: { range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 0, endColumnIndex: SCHEDULE_HEADERS.length }, rows: [{ values: recordToRow(SCHEDULE_HEADERS, schedule).map(scheduleCell) }], fields: "userEnteredValue" } };
}

function scheduleTokenRequest(schedule: ScheduleRecord, sheetId: number) {
  const rowStart = schedule.rowNumber - 1;
  return { addNamedRange: { namedRange: { name: scheduleStateTokenName(schedule), range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 0, endColumnIndex: SCHEDULE_HEADERS.length } } } };
}

function sameScheduleState(left: ScheduleRecord, right: ScheduleRecord): boolean {
  const leftRow = recordToRow(SCHEDULE_HEADERS, left);
  const rightRow = recordToRow(SCHEDULE_HEADERS, right);
  return left.rowNumber === right.rowNumber && leftRow.every((value, index) => value === rightRow[index]);
}

async function readScheduleRow(schedule: ScheduleRecord): Promise<ScheduleRecord | null> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `Installment Schedule!A${schedule.rowNumber}:${SCHEDULE_END_COLUMN}${schedule.rowNumber}` });
  const row = response.data.values?.[0];
  if (!row) return null;
  return { ...rowToRecord(SCHEDULE_HEADERS, row), rowNumber: schedule.rowNumber } as ScheduleRecord;
}

function tokenRanges(metadata: Awaited<ReturnType<typeof scheduleSheetMetadata>>, scheduleId: string) {
  const prefix = scheduleStatePrefix(scheduleId);
  return metadata.namedRanges.filter((range) => typeof range.name === "string" && range.name.startsWith(prefix));
}

const SCHEDULE_TOKEN_REPAIR_ATTEMPTS = 3;

async function stabilizeScheduleStateToken(schedule: ScheduleRecord): Promise<void> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  let lastRepairError: unknown;
  for (let attempt = 0; attempt < SCHEDULE_TOKEN_REPAIR_ATTEMPTS; attempt += 1) {
    const actualBeforeMetadata = await readScheduleRow(schedule);
    if (!actualBeforeMetadata || actualBeforeMetadata.schedule_id !== schedule.schedule_id) throw new Error("Schedule changed during token repair");
    const metadata = await scheduleSheetMetadata();
    const actualAfterMetadata = await readScheduleRow(schedule);
    if (!actualAfterMetadata || actualAfterMetadata.schedule_id !== schedule.schedule_id) throw new Error("Schedule changed during token repair");
    if (!sameScheduleState(actualBeforeMetadata, actualAfterMetadata)) continue;

    const tokens = tokenRanges(metadata, schedule.schedule_id);
    const currentTokenName = scheduleStateTokenName(actualAfterMetadata);
    const currentTokens = tokens.filter((token) => token.name === currentTokenName);
    if (tokens.length === 1 && currentTokens.length === 1 && currentTokens[0].namedRangeId) return;
    if (tokens.some((token) => !token.namedRangeId) || currentTokens.length > 1) continue;

    const requests = [
      ...tokens.filter((token) => token.name !== currentTokenName).map((token) => ({ deleteNamedRange: { namedRangeId: token.namedRangeId as string } })),
      ...(currentTokens.length === 0 ? [scheduleTokenRequest(actualAfterMetadata, metadata.sheetId)] : []),
    ];
    if (!requests.length) continue;
    try {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
      return;
    } catch (error) {
      lastRepairError = error;
    }
  }
  if (lastRepairError) throw lastRepairError;
  throw new Error("Schedule state token repair did not stabilize");
}

async function ensureExpectedScheduleToken(expectedSchedule: ScheduleRecord): Promise<boolean> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const initialActual = await readScheduleRow(expectedSchedule);
  if (!initialActual || !sameScheduleState(initialActual, expectedSchedule)) return false;
  let metadata = await scheduleSheetMetadata();
  let tokens = tokenRanges(metadata, expectedSchedule.schedule_id);
  const expectedTokenName = scheduleStateTokenName(expectedSchedule);
  let currentToken = tokens.find((token) => token.name === expectedTokenName && token.namedRangeId) ?? null;
  if (!currentToken) {
    if (tokens.length) {
      await stabilizeScheduleStateToken(expectedSchedule);
      return false;
    }
    try {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [scheduleTokenRequest(expectedSchedule, metadata.sheetId)] } });
    } catch (error) {
      const conflict = scheduleStateConflict(error);
      await stabilizeScheduleStateToken(expectedSchedule);
      if (conflict) return false;
      throw error;
    }
    metadata = await scheduleSheetMetadata();
    tokens = tokenRanges(metadata, expectedSchedule.schedule_id);
    currentToken = tokens.find((token) => token.name === expectedTokenName && token.namedRangeId) ?? null;
    const refreshedActual = await readScheduleRow(expectedSchedule);
    if (!currentToken || tokens.length !== 1 || !refreshedActual || !sameScheduleState(refreshedActual, expectedSchedule)) {
      await stabilizeScheduleStateToken(expectedSchedule);
      return false;
    }
  }
  if (tokens.length !== 1 || !currentToken.namedRangeId) {
    await stabilizeScheduleStateToken(expectedSchedule);
    return false;
  }
  return true;
}

export async function listSchedules(): Promise<ScheduleRecord[]> {
  await ensureScheduleSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `Installment Schedule!A:${SCHEDULE_END_COLUMN}` });
  return (response.data.values ?? [])
    .slice(1)
    .map((row, index) => ({ ...rowToRecord(SCHEDULE_HEADERS, row), rowNumber: index + 2 }) as ScheduleRecord)
    .filter((row) => row.schedule_id);
}

export async function writeSchedule(schedule: NewScheduleRecord): Promise<void> {
  await ensureScheduleSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `Installment Schedule!A:${SCHEDULE_END_COLUMN}` });
  const rowNumber = firstEmptyIdRow((response.data.values ?? []).slice(1));
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Installment Schedule!A${rowNumber}:${SCHEDULE_END_COLUMN}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [recordToRow(SCHEDULE_HEADERS, schedule)] },
  });
}

export async function updateSchedule(schedule: ScheduleRecord): Promise<void> {
  if (!Number.isInteger(schedule.rowNumber) || schedule.rowNumber < 2) throw new Error("Schedule physical row is required");
  await ensureScheduleSchema();
  const { sheets, spreadsheetId } = await getGoogleSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Installment Schedule!A${schedule.rowNumber}:${SCHEDULE_END_COLUMN}${schedule.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [recordToRow(SCHEDULE_HEADERS, schedule)] },
  });
}

/** Atomically writes one schedule only while its complete expected row is unchanged. */
export async function updateScheduleIfUnchanged({ schedule, expectedSchedule }: ScheduleUpdate): Promise<boolean> {
  return updateSchedulesIfUnchanged({ updates: [{ schedule, expectedSchedule }] });
}

/** Atomically writes all supplied schedules only while every complete expected row is unchanged. */
export async function updateSchedulesIfUnchanged({ updates }: { updates: readonly ScheduleUpdate[] }): Promise<boolean> {
  if (!updates.length) return true;
  const rows = new Set<number>();
  for (const { schedule, expectedSchedule } of updates) {
    if (!Number.isInteger(schedule.rowNumber) || schedule.rowNumber < 2) throw new Error("Schedule physical row is required");
    if (schedule.rowNumber !== expectedSchedule.rowNumber) throw new Error("Schedule and expected schedule must target the same physical row");
    if (schedule.schedule_id !== expectedSchedule.schedule_id) throw new Error("Schedule identity cannot change during update");
    if (rows.has(schedule.rowNumber)) throw new Error("Schedule update rows must be unique");
    rows.add(schedule.rowNumber);
  }
  await ensureScheduleSchema();
  for (const { expectedSchedule } of updates) {
    if (!await ensureExpectedScheduleToken(expectedSchedule)) return false;
  }

  const { sheets, spreadsheetId } = await getGoogleSheets();
  const metadata = await scheduleSheetMetadata();
  const reservations = updates.map(({ expectedSchedule }) => {
    const tokens = tokenRanges(metadata, expectedSchedule.schedule_id);
    const currentToken = tokens.find((token) => token.name === scheduleStateTokenName(expectedSchedule) && token.namedRangeId);
    return tokens.length === 1 && currentToken?.namedRangeId ? currentToken.namedRangeId : null;
  });
  if (reservations.some((reservation) => !reservation)) return false;

  try {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
      ...reservations.map((namedRangeId) => ({ deleteNamedRange: { namedRangeId: namedRangeId as string } })),
      ...updates.flatMap(({ schedule }) => [scheduleTokenRequest(schedule, metadata.sheetId), scheduleRowRequest(schedule, metadata.sheetId)]),
    ] } });
    return true;
  } catch (error) {
    if (scheduleStateConflict(error)) return false;
    throw error;
  }
}
