import { getGoogleSheets } from "./client";
import { SCHEDULE_HEADERS, firstEmptyIdRow, recordToRow, rowToRecord } from "./records";

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
};

export type NewScheduleRecord = Omit<ScheduleRecord, "rowNumber">;

export async function listSchedules(): Promise<ScheduleRecord[]> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Installment Schedule!A:R" });
  return (response.data.values ?? [])
    .slice(1)
    .map((row, index) => ({ ...rowToRecord(SCHEDULE_HEADERS, row), rowNumber: index + 2 }) as ScheduleRecord)
    .filter((row) => row.schedule_id);
}

export async function writeSchedule(schedule: NewScheduleRecord): Promise<void> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Installment Schedule!A:R" });
  const rowNumber = firstEmptyIdRow((response.data.values ?? []).slice(1));
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Installment Schedule!A${rowNumber}:R${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [recordToRow(SCHEDULE_HEADERS, schedule)] },
  });
}

export async function updateSchedule(schedule: ScheduleRecord): Promise<void> {
  if (!Number.isInteger(schedule.rowNumber) || schedule.rowNumber < 2) throw new Error("Schedule physical row is required");
  const { sheets, spreadsheetId } = await getGoogleSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Installment Schedule!A${schedule.rowNumber}:R${schedule.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [recordToRow(SCHEDULE_HEADERS, schedule)] },
  });
}
