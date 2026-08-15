import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEDULE_HEADERS, sheetColumnName } from "./records";

const { ensureScheduleSchema, get, update } = vi.hoisted(() => ({
  ensureScheduleSchema: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({
    spreadsheetId: "spreadsheet_1",
    sheets: { spreadsheets: { values: { get, update } } },
  }),
}));
vi.mock("./migration", () => ({ ensureScheduleSchema }));

import { listSchedules, updateSchedule, writeSchedule, type NewScheduleRecord } from "./schedules";

beforeEach(() => {
  vi.clearAllMocks();
  ensureScheduleSchema.mockResolvedValue(undefined);
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
    expect(writtenRow.slice(-2)).toEqual(["", ""]);
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
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Installment Schedule!A4:T4" }));
  });
});
