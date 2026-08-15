import { beforeEach, describe, expect, it, vi } from "vitest";
import { lineReservationName } from "@/lib/line/connection-reservation";
import { LINE_MESSAGE_TEST_PROFILE_SETTING_KEY, type LineMessageTestProfile } from "@/lib/line/message-test-profile";

const mocks = vi.hoisted(() => ({
  valuesGet: vi.fn(),
  valuesBatchUpdate: vi.fn(),
  spreadsheetGet: vi.fn(),
  spreadsheetBatchUpdate: vi.fn(),
}));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({
    spreadsheetId: "spreadsheet_1",
    sheets: { spreadsheets: {
      values: { get: mocks.valuesGet, batchUpdate: mocks.valuesBatchUpdate },
      get: mocks.spreadsheetGet,
      batchUpdate: mocks.spreadsheetBatchUpdate,
    } },
  }),
}));

import {
  claimLineMessageTestConnection,
  disconnectLineMessageTestConnection,
  getLineMessageTestProfile,
  saveLineMessageTestProfile,
  updateLineMessageTestProfileIfUnchanged,
} from "./line-message-test-profile";

const tokenHash = "a".repeat(64);
const lineUserId = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function profile(overrides: Partial<LineMessageTestProfile> = {}): LineMessageTestProfile {
  return {
    version: 1,
    clientName: "Test Client",
    packageName: "Test Package",
    totalPriceThb: "3000",
    paymentType: "INSTALLMENTS",
    installmentCount: 3,
    intervalMonths: 1,
    firstDueDate: "2026-08-15",
    lineUserId: "",
    lineDisplayName: "",
    linePictureUrl: "",
    lineLinkStatus: "LINK_ACTIVE",
    lineLinkedAt: "",
    lineLinkError: "",
    lineLinkTokenHash: tokenHash,
    lineLinkTokenEncrypted: "encrypted-token",
    lineLinkTokenExpiresAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

function settingsRows(current: LineMessageTestProfile | null): unknown[][] {
  return current
    ? [["key", "value"], [LINE_MESSAGE_TEST_PROFILE_SETTING_KEY, JSON.stringify(current)]]
    : [["key", "value"]];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.valuesGet.mockResolvedValue({ data: { values: settingsRows(profile()) } });
  mocks.valuesBatchUpdate.mockResolvedValue({});
  mocks.spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 7, title: "Settings" } }], namedRanges: [] } });
  mocks.spreadsheetBatchUpdate.mockResolvedValue({});
});

describe("LINE message test profile repository", () => {
  it("reads no profile when its Settings key is absent and validates normal saves", async () => {
    mocks.valuesGet.mockResolvedValueOnce({ data: { values: settingsRows(null) } });
    await expect(getLineMessageTestProfile()).resolves.toBeNull();

    await saveLineMessageTestProfile(profile());
    const saved = mocks.valuesBatchUpdate.mock.calls[0]?.[0].requestBody.data[0].values[0];
    expect(saved[0]).toBe(LINE_MESSAGE_TEST_PROFILE_SETTING_KEY);
    expect(JSON.parse(saved[1])).toEqual(expect.objectContaining(profile()));
  });

  it("updates only while exact expected profile state remains claimable", async () => {
    const expectedProfile = profile();
    const next = profile({ clientName: "Edited", updatedAt: "2026-08-16T00:00:00.000Z" });

    await expect(updateLineMessageTestProfileIfUnchanged({ expectedProfile, profile: next })).resolves.toBe(true);

    expect(mocks.spreadsheetBatchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { requests: expect.arrayContaining([
      { addNamedRange: { namedRange: expect.objectContaining({ name: expect.stringMatching(/^line_message_test_state_[a-f0-9]{64}$/) }) } },
      { updateCells: expect.objectContaining({ range: expect.objectContaining({ sheetId: 7, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 }) }) },
    ]) } }));
  });

  it("atomically reserves shared token and user names while linking", async () => {
    const expectedProfile = profile();
    const linked = profile({
      lineUserId,
      lineDisplayName: "LINE Test",
      lineLinkStatus: "LINKED",
      lineLinkedAt: "2026-08-16T00:00:00.000Z",
      lineLinkTokenEncrypted: "",
      lineLinkTokenExpiresAt: "",
    });

    await expect(claimLineMessageTestConnection({ expectedProfile, profile: linked, tokenHash, lineUserId })).resolves.toBe("CLAIMED");

    expect(mocks.spreadsheetBatchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { requests: expect.arrayContaining([
      { addNamedRange: { namedRange: expect.objectContaining({ name: lineReservationName("token", tokenHash) }) } },
      { addNamedRange: { namedRange: expect.objectContaining({ name: lineReservationName("user", lineUserId) }) } },
    ]) } }));
  });

  it("rejects mismatched token or LINE identity before touching Sheets", async () => {
    await expect(claimLineMessageTestConnection({
      expectedProfile: profile(),
      profile: profile({ lineUserId: "Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", lineLinkStatus: "LINKED" }),
      tokenHash,
      lineUserId,
    })).rejects.toThrow("does not match");
    await expect(claimLineMessageTestConnection({
      expectedProfile: profile(),
      profile: profile({ lineUserId, lineLinkStatus: "LINKED" }),
      tokenHash: "b".repeat(64),
      lineUserId,
    })).rejects.toThrow("does not match");
    expect(mocks.spreadsheetBatchUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["ALREADY_LINKED", profile({ lineUserId, lineLinkStatus: "LINKED", lineLinkTokenEncrypted: "", lineLinkTokenExpiresAt: "" }), []],
    ["CONFLICT", profile(), [{ name: lineReservationName("user", lineUserId), namedRangeId: "user-reservation" }]],
    ["STALE", profile({ updatedAt: "2026-08-17T00:00:00.000Z" }), []],
  ] as const)("classifies duplicate claim as %s", async (expected, current, namedRanges) => {
    mocks.spreadsheetBatchUpdate.mockRejectedValueOnce(Object.assign(new Error("Named range already exists"), { response: { status: 400 } }));
    mocks.valuesGet
      .mockResolvedValueOnce({ data: { values: settingsRows(profile()) } })
      .mockResolvedValue({ data: { values: settingsRows(current) } });
    mocks.spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 7, title: "Settings" } }], namedRanges } });

    await expect(claimLineMessageTestConnection({
      expectedProfile: profile(),
      profile: profile({ lineUserId, lineLinkStatus: "LINKED" }),
      tokenHash,
      lineUserId,
    })).resolves.toBe(expected);
  });

  it("disconnects test recipient and releases only its user reservation", async () => {
    const expectedProfile = profile({ lineUserId, lineLinkStatus: "LINKED" });
    const disconnected = profile({ lineUserId: "", lineDisplayName: "", lineLinkStatus: "", lineLinkTokenHash: "", lineLinkTokenEncrypted: "", lineLinkTokenExpiresAt: "" });
    mocks.valuesGet.mockResolvedValueOnce({ data: { values: settingsRows(expectedProfile) } });
    mocks.spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 7, title: "Settings" } }], namedRanges: [
      { name: lineReservationName("user", lineUserId), namedRangeId: "test-user" },
      { name: lineReservationName("user", "Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), namedRangeId: "other-user" },
    ] } });

    await expect(disconnectLineMessageTestConnection({ expectedProfile, profile: disconnected })).resolves.toBe(true);
    const request = mocks.spreadsheetBatchUpdate.mock.calls[0]?.[0];
    expect(request.requestBody.requests).toContainEqual({ deleteNamedRange: { namedRangeId: "test-user" } });
    expect(request.requestBody.requests).not.toContainEqual({ deleteNamedRange: { namedRangeId: "other-user" } });
  });
});
