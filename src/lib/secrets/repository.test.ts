import { beforeEach, describe, expect, it, vi } from "vitest";

const { batchUpdate, get, spreadsheetGet, update } = vi.hoisted(() => ({ batchUpdate: vi.fn(), get: vi.fn(), spreadsheetGet: vi.fn(), update: vi.fn() }));

vi.mock("@/lib/sheets/bootstrap-client", () => ({
  getBootstrapSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { get: spreadsheetGet, batchUpdate, values: { get, update } } } }),
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

const otherEncryptedRecord = { ...encryptedRecord, keyName: "line_channel_secret" as const, ciphertext: "other-ciphertext", iv: "other-iv", authTag: "other-tag", lastFour: "cret" };
const driveEncryptedRecord = { ...encryptedRecord, keyName: "google_workspace_connection" as const, ciphertext: "drive-ciphertext", iv: "drive-iv", authTag: "drive-tag", lastFour: "" };

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

  it("parses the encrypted Google Drive connection key without token metadata", async () => {
    get.mockResolvedValue({ data: { values: [["key_name", "ciphertext", "iv", "auth_tag", "algorithm", "key_version", "created_at", "updated_at", "last_four", "status", "notes"], [driveEncryptedRecord.keyName, driveEncryptedRecord.ciphertext, driveEncryptedRecord.iv, driveEncryptedRecord.authTag, driveEncryptedRecord.algorithm, driveEncryptedRecord.keyVersion, driveEncryptedRecord.createdAt, driveEncryptedRecord.updatedAt, driveEncryptedRecord.lastFour, "ACTIVE", ""]] } });

    await expect(getSecretRecord("google_workspace_connection")).resolves.toMatchObject(driveEncryptedRecord);
    await expect(listSecretMetadata()).resolves.toEqual([{ rowNumber: 2, keyName: "google_workspace_connection", algorithm: "aes-256-gcm", keyVersion: "1", createdAt: driveEncryptedRecord.createdAt, updatedAt: driveEncryptedRecord.updatedAt, lastFour: "" }]);
  });

  it("updates one secret row without overwriting another encrypted secret", async () => {
    get.mockResolvedValue({ data: { values: [["key_name", "ciphertext", "iv", "auth_tag", "algorithm", "key_version", "created_at", "updated_at", "last_four", "status", "notes"], [encryptedRecord.keyName, encryptedRecord.ciphertext, encryptedRecord.iv, encryptedRecord.authTag, encryptedRecord.algorithm, encryptedRecord.keyVersion, encryptedRecord.createdAt, encryptedRecord.updatedAt, encryptedRecord.lastFour, "ACTIVE", ""], [otherEncryptedRecord.keyName, otherEncryptedRecord.ciphertext, otherEncryptedRecord.iv, otherEncryptedRecord.authTag, otherEncryptedRecord.algorithm, otherEncryptedRecord.keyVersion, otherEncryptedRecord.createdAt, otherEncryptedRecord.updatedAt, otherEncryptedRecord.lastFour, "ACTIVE", ""]] } });

    await upsertSecretRecord({ ...encryptedRecord, ciphertext: "replacement-ciphertext" });

    const write = update.mock.calls.at(-1)?.[0];
    expect(write).toMatchObject({ range: "Integration Secrets!A2:K2" });
    expect(JSON.stringify(write)).not.toContain(otherEncryptedRecord.ciphertext);
  });

  it("coalesces concurrent first-time schema setup", async () => {
    vi.resetModules();
    const { listSecretMetadata: listFreshSecretMetadata } = await import("./repository");
    let releaseMetadata: (() => void) | undefined;
    const metadataReady = new Promise<void>((resolve) => { releaseMetadata = resolve; });
    spreadsheetGet.mockImplementationOnce(async () => {
      await metadataReady;
      return { data: { sheets: [] } };
    });
    get.mockResolvedValue({ data: { values: [["key_name", "ciphertext", "iv", "auth_tag", "algorithm", "key_version", "created_at", "updated_at", "last_four", "status", "notes"]] } });

    const first = listFreshSecretMetadata();
    const second = listFreshSecretMetadata();
    await Promise.resolve();

    expect(spreadsheetGet).toHaveBeenCalledTimes(1);
    releaseMetadata?.();
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
  });

  it("creates the Integration Secrets tab and writes missing A:K headers", async () => {
    vi.resetModules();
    const { listSecretMetadata: listFreshSecretMetadata } = await import("./repository");
    spreadsheetGet.mockResolvedValueOnce({ data: { sheets: [] } });
    get.mockResolvedValueOnce({ data: { values: [[]] } }).mockResolvedValueOnce({ data: { values: [[]] } });

    await listFreshSecretMetadata();

    expect(batchUpdate).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", requestBody: { requests: [{ addSheet: { properties: { title: "Integration Secrets" } } }] } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Integration Secrets!A1", requestBody: { values: [["key_name"]] } }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Integration Secrets!K1", requestBody: { values: [["notes"]] } }));
  });
});
