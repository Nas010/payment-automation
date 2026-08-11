import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batchGet: vi.fn(),
  ensureClientSchema: vi.fn(),
  ensurePaymentSchema: vi.fn(),
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
}));

import { readPaymentClientSnapshot } from "./payment-client-snapshot";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureClientSchema.mockResolvedValue(undefined);
  mocks.ensurePaymentSchema.mockResolvedValue(undefined);
});

describe("readPaymentClientSnapshot", () => {
  it("reads and parses payments and clients in one Sheets request", async () => {
    mocks.batchGet.mockResolvedValue({
      data: {
        valueRanges: [
          { values: [["payment_id", "client_id"], ["pay_1", "client_1", "Nisa"]] },
          { values: [["client_id", "active", "client_name"], ["client_1", "TRUE", "Nisa"]] },
        ],
      },
    });

    const snapshot = await readPaymentClientSnapshot();

    expect(mocks.batchGet).toHaveBeenCalledOnce();
    expect(mocks.batchGet).toHaveBeenCalledWith({
      spreadsheetId: "sheet_1",
      ranges: ["Payments!A:AR", "Clients!A:W"],
    });
    expect(snapshot.payments).toMatchObject([{ payment_id: "pay_1", client_id: "client_1", client_name: "Nisa", rowNumber: 2 }]);
    expect(snapshot.clients).toMatchObject([{ client_id: "client_1", active: "TRUE", client_name: "Nisa", rowNumber: 2 }]);
  });
});
