import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEDULE_HEADERS, sheetColumnName } from "./records";

const { batchUpdate, ensureScheduleSchema, get, spreadsheetGet, update } = vi.hoisted(() => ({
  batchUpdate: vi.fn(),
  ensureScheduleSchema: vi.fn(),
  get: vi.fn(),
  spreadsheetGet: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({
    spreadsheetId: "spreadsheet_1",
    sheets: { spreadsheets: { get: spreadsheetGet, batchUpdate, values: { get, update } } },
  }),
}));
vi.mock("./migration", () => ({ ensureScheduleSchema }));

import { listSchedules, scheduleStateTokenName, updateSchedule, updateScheduleIfUnchanged, updateSchedulesIfUnchanged, writeSchedule, type NewScheduleRecord, type ScheduleRecord } from "./schedules";

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    rowNumber: 2,
    schedule_id: "schedule_1",
    client_id: "client_1",
    client_name: "Nisa",
    line_user_id: "",
    line_display_name: "",
    package_name: "PT",
    payment_type: "INSTALLMENTS",
    installment_number: "1",
    installment_count: "2",
    amount_thb: "500",
    due_date: "2026-08-10",
    status: "SCHEDULED",
    generated_at: "",
    payment_id: "",
    payment_url: "",
    notes: "",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    assignment_id: "assignment_1",
    assignment_kind: "PACKAGE",
    lifecycle_operation_id: "",
    ...overrides,
  };
}

function row(record: ScheduleRecord): string[] {
  return SCHEDULE_HEADERS.map((header) => record[header] ?? "");
}

function metadata(namedRanges: Array<{ name: string; namedRangeId: string }> = []) {
  return { data: { sheets: [{ properties: { sheetId: 14, title: "Installment Schedule" } }], namedRanges } };
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureScheduleSchema.mockResolvedValue(undefined);
  spreadsheetGet.mockResolvedValue(metadata());
  batchUpdate.mockResolvedValue({});
});

describe("Installment Schedule repository", () => {
  it("migrates schedule schema and uses its final column for reads and writes", async () => {
    const scheduleEndColumn = sheetColumnName(SCHEDULE_HEADERS.length);
    get
      .mockResolvedValueOnce({ data: { values: [["schedule_id"]] } })
      .mockResolvedValueOnce({ data: { values: [["schedule_id"]] } });
    update.mockResolvedValue(undefined);

    await listSchedules();
    await writeSchedule({
      schedule_id: "schedule_1",
      client_id: "client_1",
      client_name: "Nisa",
      line_user_id: "",
      line_display_name: "",
      package_name: "PT",
      payment_type: "INSTALLMENTS",
      installment_number: "1",
      installment_count: "3",
      amount_thb: "1500",
      due_date: "2026-08-10",
      status: "SCHEDULED",
      generated_at: "",
      payment_id: "",
      payment_url: "",
      notes: "",
      created_at: "",
      updated_at: "",
      assignment_id: "assignment_1",
      assignment_kind: "PACKAGE",
    });

    expect(ensureScheduleSchema).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(1, { spreadsheetId: "spreadsheet_1", range: `Installment Schedule!A:${scheduleEndColumn}` });
    expect(get).toHaveBeenNthCalledWith(2, { spreadsheetId: "spreadsheet_1", range: `Installment Schedule!A:${scheduleEndColumn}` });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      range: `Installment Schedule!A2:${scheduleEndColumn}2`,
      requestBody: { values: [expect.arrayContaining(["assignment_1", "PACKAGE"]) ] },
    }));
  });

  it("writes blank assignment metadata for a legacy schedule producer", async () => {
    const legacySchedule: NewScheduleRecord = {
      schedule_id: "schedule_1",
      client_id: "client_1",
      client_name: "Nisa",
      line_user_id: "",
      line_display_name: "",
      package_name: "PT",
      payment_type: "INSTALLMENTS",
      installment_number: "1",
      installment_count: "3",
      amount_thb: "1500",
      due_date: "2026-08-10",
      status: "SCHEDULED",
      generated_at: "",
      payment_id: "",
      payment_url: "",
      notes: "",
      created_at: "",
      updated_at: "",
    };
    get.mockResolvedValueOnce({ data: { values: [["schedule_id"]] } });
    update.mockResolvedValue(undefined);

    await writeSchedule(legacySchedule);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { values: [expect.arrayContaining(["", ""])] },
    }));
    const writtenRow = update.mock.calls[0]?.[0].requestBody.values[0];
    expect(writtenRow.slice(-3)).toEqual(["", "", ""]);
  });

  it("preserves physical row numbers when filtered schedule rows are updated", async () => {
    get.mockResolvedValueOnce({ data: { values: [
      ["schedule_id", "client_id"],
      ["schedule_1", "client_1"],
      ["", "abandoned row"],
      ["schedule_2", "client_2"],
    ] } });
    update.mockResolvedValueOnce({});

    const schedules = await listSchedules();
    const schedule = schedules.find((candidate) => candidate.schedule_id === "schedule_2");
    if (!schedule) throw new Error("Fixture did not load schedule_2");
    await updateSchedule({ ...schedule, status: "GENERATED" });

    expect(schedule.rowNumber).toBe(4);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Installment Schedule!A4:U4" }));
  });

  it("refuses a stale expected schedule after rereading the complete physical row", async () => {
    const expected = schedule();
    get.mockResolvedValue({ data: { values: [row(schedule({ status: "PAUSED", lifecycle_operation_id: "pause_won" }))] } });

    await expect(updateScheduleIfUnchanged({
      expectedSchedule: expected,
      schedule: schedule({ status: "GENERATED", payment_id: "pay_1" }),
    })).resolves.toBe(false);

    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("atomically swaps complete-row state tokens for every schedule in one batch", async () => {
    const first = schedule();
    const second = schedule({ rowNumber: 3, schedule_id: "schedule_2", installment_number: "2" });
    get.mockImplementation(async ({ range }: { range: string }) => ({ data: { values: [row(range.includes("A2:") ? first : second)] } }));
    spreadsheetGet.mockResolvedValue(metadata([
      { name: scheduleStateTokenName(first), namedRangeId: "token_1" },
      { name: scheduleStateTokenName(second), namedRangeId: "token_2" },
    ]));

    await expect(updateSchedulesIfUnchanged({ updates: [
      { expectedSchedule: first, schedule: schedule({ status: "CANCELLED", lifecycle_operation_id: "change_1" }) },
      { expectedSchedule: second, schedule: schedule({ rowNumber: 3, schedule_id: "schedule_2", installment_number: "2", status: "CANCELLED", lifecycle_operation_id: "change_1" }) },
    ] })).resolves.toBe(true);

    expect(batchUpdate).toHaveBeenCalledOnce();
    const requests = batchUpdate.mock.calls[0]?.[0].requestBody.requests;
    expect(requests.filter((request: { deleteNamedRange?: unknown }) => request.deleteNamedRange)).toEqual([
      { deleteNamedRange: { namedRangeId: "token_1" } },
      { deleteNamedRange: { namedRangeId: "token_2" } },
    ]);
    expect(requests.filter((request: { updateCells?: unknown }) => request.updateCells)).toHaveLength(2);
  });
});
