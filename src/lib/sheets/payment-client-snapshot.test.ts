import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEDULE_HEADERS, sheetColumnName } from "./records";

const mocks = vi.hoisted(() => ({
  batchGet: vi.fn(),
  ensureClientSchema: vi.fn(),
  ensurePaymentSchema: vi.fn(),
  ensureScheduleSchema: vi.fn(),
}));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({
    sheets: { spreadsheets: { values: { batchGet: mocks.batchGet } } },
    spreadsheetId: "sheet_1",
  }),
}));
vi.mock("./migration", () => ({
  ensureClientSchema: mocks.ensureClientSchema,
  ensurePaymentSchema: mocks.ensurePaymentSchema,
  ensureScheduleSchema: mocks.ensureScheduleSchema,
}));

import { readPaymentClientSnapshot } from "./payment-client-snapshot";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureClientSchema.mockResolvedValue(undefined);
  mocks.ensurePaymentSchema.mockResolvedValue(undefined);
  mocks.ensureScheduleSchema.mockResolvedValue(undefined);
});

describe("readPaymentClientSnapshot", () => {
  it("reads and parses payments, clients, and schedules in one Sheets request", async () => {
    mocks.batchGet.mockResolvedValue({
      data: {
        valueRanges: [
          { values: [["payment_id", "client_id"], ["pay_1", "client_1", "Nisa"]] },
          { values: [["client_id", "active", "client_name"], ["client_1", "TRUE", "Nisa"]] },
          { values: [["schedule_id", "client_id"], ["schedule_1", "client_1", "Nisa", "", "", "PT", "INSTALLMENTS", "1", "3", "1500", "2026-08-10", "SCHEDULED", "", "pay_1"]] },
        ],
      },
    });

    const snapshot = await readPaymentClientSnapshot();

    expect(mocks.batchGet).toHaveBeenCalledOnce();
    expect(mocks.batchGet).toHaveBeenCalledWith({
      spreadsheetId: "sheet_1",
      ranges: ["Payments!A:AY", "Clients!A:AA", `Installment Schedule!A:${sheetColumnName(SCHEDULE_HEADERS.length)}`],
    });
    expect(mocks.ensureScheduleSchema).toHaveBeenCalledOnce();
    expect(snapshot.payments).toMatchObject([{ payment_id: "pay_1", client_id: "client_1", client_name: "Nisa", rowNumber: 2 }]);
    expect(snapshot.clients).toMatchObject([{ client_id: "client_1", active: "TRUE", client_name: "Nisa", rowNumber: 2 }]);
    expect(snapshot.schedules).toMatchObject([{ schedule_id: "schedule_1", payment_id: "pay_1", rowNumber: 2 }]);
  });
});
