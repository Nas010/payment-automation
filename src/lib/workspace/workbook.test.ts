import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_HEADERS, CLIENT_HEADERS, PAYMENT_HEADERS, SCHEDULE_HEADERS } from "@/lib/sheets/records";
import { DEFAULT_LINE_DUE_PROFILES } from "@/lib/line/message-profile";
import { DEFAULT_LINE_WELCOME_TEMPLATE } from "@/lib/line/message-template";

const connectionMocks = vi.hoisted(() => ({ savePendingWorkspaceConnection: vi.fn() }));
vi.mock("./connection", () => ({ savePendingWorkspaceConnection: connectionMocks.savePendingWorkspaceConnection }));

import { provisionOperationalWorkbook } from "./workbook";

const create = vi.fn();
const get = vi.fn();
const batchUpdate = vi.fn();
const valuesBatchUpdate = vi.fn();
const valuesBatchGet = vi.fn();

const authorization = {
  refreshToken: "refresh-token",
  accountGoogleSub: "google-sub-1",
  accountEmail: "owner@example.com",
};

const api = {
  spreadsheets: {
    create,
    get,
    batchUpdate,
    values: { batchUpdate: valuesBatchUpdate, batchGet: valuesBatchGet },
  },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  connectionMocks.savePendingWorkspaceConnection.mockResolvedValue(undefined);
  create.mockResolvedValue({ data: { spreadsheetId: "new-sheet-123456", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new-sheet-123456/edit", properties: { title: "Coaching Payments - Automated" }, sheets: [
    { properties: { sheetId: 1, title: "Clients" } },
    { properties: { sheetId: 2, title: "Installment Schedule" } },
    { properties: { sheetId: 3, title: "Payments" } },
    { properties: { sheetId: 4, title: "Settings" } },
    { properties: { sheetId: 5, title: "Audit Log" } },
  ] } });
  get.mockResolvedValue({ data: { properties: { title: "Coaching Payments - Automated", timeZone: "Asia/Bangkok" }, sheets: [
    { properties: { sheetId: 1, title: "Clients" }, data: [{ rowData: [{ values: CLIENT_HEADERS.map((value) => ({ formattedValue: value })) }] }] },
    { properties: { sheetId: 2, title: "Installment Schedule" }, data: [{ rowData: [{ values: SCHEDULE_HEADERS.map((value) => ({ formattedValue: value })) }] }] },
    { properties: { sheetId: 3, title: "Payments" }, data: [{ rowData: [{ values: PAYMENT_HEADERS.map((value) => ({ formattedValue: value })) }] }] },
    { properties: { sheetId: 4, title: "Settings" }, data: [{ rowData: [{ values: [{ formattedValue: "key" }, { formattedValue: "value" }] }] }] },
    { properties: { sheetId: 5, title: "Audit Log" }, data: [{ rowData: [{ values: AUDIT_HEADERS.map((value) => ({ formattedValue: value })) }] }] },
  ] } });
  batchUpdate.mockResolvedValue({});
  valuesBatchUpdate.mockResolvedValue({});
  valuesBatchGet.mockResolvedValue({ data: { valueRanges: [
    { values: [[...CLIENT_HEADERS]] },
    { values: [[...SCHEDULE_HEADERS]] },
    { values: [[...PAYMENT_HEADERS]] },
    { values: [["key", "value"]] },
    { values: [["package_name", "total_price_thb", "payment_type", "installment_count", "interval_months", "active"]] },
    { values: [[...AUDIT_HEADERS]] },
  ] } });
});

describe("operational workbook provisioning", () => {
  it("creates only the five dashboard-owned tabs with exact headers and Bangkok timezone", async () => {
    const result = await provisionOperationalWorkbook({ authorization, sheets: api });

    expect(result).toMatchObject({
      spreadsheetId: "new-sheet-123456",
      spreadsheetName: "Coaching Payments - Automated",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new-sheet-123456/edit",
    });
    expect(create).toHaveBeenCalledWith({ requestBody: {
      properties: { title: "Coaching Payments - Automated", timeZone: "Asia/Bangkok" },
      sheets: ["Clients", "Installment Schedule", "Payments", "Settings", "Audit Log"].map((title) => ({ properties: { title } })),
    } });
    const headerWrite = valuesBatchUpdate.mock.calls[0][0];
    expect(headerWrite.requestBody.data).toEqual([
      { range: "Clients!A1:Z1", values: [[...CLIENT_HEADERS]] },
      { range: "Installment Schedule!A1:R1", values: [[...SCHEDULE_HEADERS]] },
      { range: "Payments!A1:AR1", values: [[...PAYMENT_HEADERS]] },
      { range: "Settings!A1:B1", values: [["key", "value"]] },
      { range: "Settings!A2:B10", values: expect.arrayContaining([
        ["business_display_name", "Coaching Payments"],
        ["line_linking_enabled", "false"],
        ["line_welcome_message_template", DEFAULT_LINE_WELCOME_TEMPLATE],
        ["line_due_message_profile_one_time", JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME)],
        ["line_due_message_profile_installments", JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS)],
      ]) },
      { range: "Settings!D3:I3", values: [["package_name", "total_price_thb", "payment_type", "installment_count", "interval_months", "active"]] },
      { range: "Audit Log!A1:I1", values: [[...AUDIT_HEADERS]] },
    ]);
    const requests = batchUpdate.mock.calls[0][0].requestBody.requests;
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ updateSheetProperties: expect.any(Object) }),
      expect.objectContaining({ repeatCell: expect.any(Object) }),
      expect.objectContaining({ setBasicFilter: expect.any(Object) }),
    ]));
  });

  it("validates a staged spreadsheet on retry instead of creating a duplicate", async () => {
    const staged = { ...authorization, spreadsheetId: "existing-sheet-123", spreadsheetName: "Coaching Payments - Automated", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/existing-sheet-123/edit" };

    await expect(provisionOperationalWorkbook({ authorization: staged, sheets: api })).resolves.toMatchObject({ spreadsheetId: "existing-sheet-123" });
    expect(create).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: "existing-sheet-123" }));
    expect(valuesBatchUpdate).not.toHaveBeenCalled();
  });

  it("repairs a partially initialized staged spreadsheet without creating a duplicate", async () => {
    const staged = { ...authorization, spreadsheetId: "partial-sheet-123", spreadsheetName: "Coaching Payments - Automated", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/partial-sheet-123/edit" };
    valuesBatchGet
      .mockResolvedValueOnce({ data: { valueRanges: [] } })
      .mockResolvedValueOnce({ data: { valueRanges: [
        { values: [[...CLIENT_HEADERS]] },
        { values: [[...SCHEDULE_HEADERS]] },
        { values: [[...PAYMENT_HEADERS]] },
        { values: [["key", "value"]] },
        { values: [["package_name", "total_price_thb", "payment_type", "installment_count", "interval_months", "active"]] },
        { values: [[...AUDIT_HEADERS]] },
      ] } });

    await expect(provisionOperationalWorkbook({ authorization: staged, sheets: api })).resolves.toMatchObject({ spreadsheetId: "partial-sheet-123" });
    expect(create).not.toHaveBeenCalled();
    expect(valuesBatchUpdate).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
  });
});
