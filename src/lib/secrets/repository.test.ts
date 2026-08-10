import { beforeEach, describe, expect, it, vi } from "vitest";

const { batchUpdate, get, spreadsheetGet, update } = vi.hoisted(() => ({ batchUpdate: vi.fn(), get: vi.fn(), spreadsheetGet: vi.fn(), update: vi.fn() }));

vi.mock("@/lib/sheets/client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { get: spreadsheetGet, batchUpdate, values: { get, update } } } }),
}));

import { getSecretRecord, listSecretMetadata, upsertSecretRecord } from "./repository";

const encryptedRecord = {
  keyName: "line_channel_access_token" as const,
  ciphertext: "ciphertext-base64",
  iv: "iv-base64",
  authTag: "tag-base64",
  algorithm: "aes-256-gcm" as const,
  keyVersion: "1",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  lastFour: "alue",
};

beforeEach(() => {
  vi.clearAllMocks();
  spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 17, title: "Integration Secrets", gridProperties: { columnCount: 11 } } }] } });
  get.mockResolvedValue({ data: { values: [["key_name", "ciphertext", "iv", "auth_tag", "algorithm", "key_version", "created_at", "updated_at", "last_four", "status", "notes"], [encryptedRecord.keyName, encryptedRecord.ciphertext, encryptedRecord.iv, encryptedRecord.authTag, encryptedRecord.algorithm, encryptedRecord.keyVersion, encryptedRecord.createdAt, encryptedRecord.updatedAt, encryptedRecord.lastFour, "ACTIVE", ""]] } });
  update.mockResolvedValue({});
});

describe("Integration Secrets repository", () => {
  it("persists ciphertext fields and safe metadata without plaintext", async () => {
    await upsertSecretRecord(encryptedRecord);

    const payload = update.mock.calls.at(-1)?.[0];
    expect(payload).toMatchObject({ spreadsheetId: "spreadsheet_1", range: "Integration Secrets!A2:K2" });
    expect(JSON.stringify(payload)).not.toContain("token-value");
    expect(payload.requestBody.values[0]).toEqual([encryptedRecord.keyName, encryptedRecord.ciphertext, encryptedRecord.iv, encryptedRecord.authTag, encryptedRecord.algorithm, encryptedRecord.keyVersion, encryptedRecord.createdAt, encryptedRecord.updatedAt, encryptedRecord.lastFour, "ACTIVE", ""]);
  });

  it("returns metadata without ciphertext, IV, tag, or plaintext", async () => {
    await expect(listSecretMetadata()).resolves.toEqual([{ rowNumber: 2, keyName: "line_channel_access_token", algorithm: "aes-256-gcm", keyVersion: "1", createdAt: encryptedRecord.createdAt, updatedAt: encryptedRecord.updatedAt, lastFour: "alue" }]);
  });

  it("returns only the selected encrypted record", async () => {
    await expect(getSecretRecord("line_channel_access_token")).resolves.toMatchObject(encryptedRecord);
  });

  it("creates the Integration Secrets tab and writes missing A:K headers", async () => {
    spreadsheetGet.mockResolvedValueOnce({ data: { sheets: [] } });
    get.mockResolvedValueOnce({ data: { values: [[]] } }).mockResolvedValueOnce({ data: { values: [[]] } });

    await listSecretMetadata();

    expect(batchUpdate).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", requestBody: { requests: [{ addSheet: { properties: { title: "Integration Secrets" } } }] } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Integration Secrets!A1", requestBody: { values: [["key_name"]] } }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Integration Secrets!K1", requestBody: { values: [["notes"]] } }));
  });
});
