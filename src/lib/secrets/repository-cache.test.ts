import { beforeEach, describe, expect, it, vi } from "vitest";

const { batchUpdate, metadataGet, valuesGet, valuesUpdate } = vi.hoisted(() => ({
  batchUpdate: vi.fn(),
  metadataGet: vi.fn(),
  valuesGet: vi.fn(),
  valuesUpdate: vi.fn(),
}));

vi.mock("@/lib/sheets/bootstrap-client", () => ({
  getBootstrapSheets: () => ({
    spreadsheetId: "bootstrap-sheet",
    sheets: { spreadsheets: { get: metadataGet, batchUpdate, values: { get: valuesGet, update: valuesUpdate } } },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  metadataGet.mockResolvedValue({
    data: { sheets: [{ properties: { sheetId: 17, title: "Integration Secrets", gridProperties: { columnCount: 11 } } }] },
  });
  valuesGet.mockResolvedValue({ data: { values: [["key_name", "ciphertext", "iv", "auth_tag", "algorithm", "key_version", "created_at", "updated_at", "last_four", "status", "notes"]] } });
});

describe("Integration Secrets schema quota cache", () => {
  it("reuses one successful schema check across repeated secret reads", async () => {
    const { listSecretMetadata } = await import("./repository");

    await listSecretMetadata();
    await listSecretMetadata();

    expect(metadataGet).toHaveBeenCalledTimes(1);
    expect(valuesGet).toHaveBeenCalledTimes(3);
  });

  it("retries schema setup after a transient quota failure", async () => {
    metadataGet.mockRejectedValueOnce(Object.assign(new Error("quota"), { response: { status: 429 } }));
    const { listSecretMetadata } = await import("./repository");

    await expect(listSecretMetadata()).rejects.toThrow("quota");
    await expect(listSecretMetadata()).resolves.toEqual([]);

    expect(metadataGet).toHaveBeenCalledTimes(2);
  });

  it("reads the secret table once when inserting the first connection", async () => {
    valuesGet
      .mockResolvedValueOnce({ data: { values: [["key_name", "ciphertext", "iv", "auth_tag", "algorithm", "key_version", "created_at", "updated_at", "last_four", "status", "notes"]] } })
      .mockResolvedValue({ data: { values: [["key_name", "ciphertext", "iv", "auth_tag", "algorithm", "key_version", "created_at", "updated_at", "last_four", "status", "notes"]] } });
    const { upsertSecretRecord } = await import("./repository");

    await upsertSecretRecord({
      keyName: "google_workspace_pending",
      ciphertext: "replacement",
      iv: "aXZhYWJjZGVmZw==",
      authTag: "YXV0aC10YWctMTIzNA==",
      algorithm: "aes-256-gcm",
      keyVersion: "1",
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T01:00:00.000Z",
      lastFour: "",
    });

    expect(valuesGet).toHaveBeenCalledTimes(2);
    expect(valuesUpdate).toHaveBeenCalledWith(expect.objectContaining({ range: "Integration Secrets!A2:K2" }));
  });
});
