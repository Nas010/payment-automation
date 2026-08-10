import { describe, expect, it, vi } from "vitest";

const update = vi.fn();
const get = vi.fn();

vi.mock("./client", () => ({
  getGoogleSheets: () => ({
    spreadsheetId: "spreadsheet_1",
    sheets: { spreadsheets: { values: { get, update } } },
  }),
}));

import { listSchedules, updateSchedule } from "./schedules";

describe("Installment Schedule repository", () => {
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
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Installment Schedule!A4:R4" }));
  });
});
