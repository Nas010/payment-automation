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
    sheets: {
      spreadsheets: {
        get: metadataGet,
        batchUpdate,
        values: { get: valuesGet, update: valuesUpdate },
      },
    },
  }),
}));

import { claimInstallationOwner, getInstallation, setInstallationStatus } from "./repository";

const existingOwner = [
  "google-sub-1",
  "owner@example.com",
  "CLAIMED",
  "2026-08-15T01:00:00.000Z",
  "2026-08-15T01:00:00.000Z",
];

beforeEach(() => {
  vi.clearAllMocks();
  metadataGet.mockResolvedValue({
    data: {
      sheets: [{ properties: { sheetId: 71, title: "Installation", gridProperties: { columnCount: 5 } } }],
      namedRanges: [],
    },
  });
  valuesGet.mockResolvedValue({ data: { values: [["owner_google_sub", "owner_email", "setup_status", "created_at", "updated_at"]] } });
  batchUpdate.mockResolvedValue({});
  valuesUpdate.mockResolvedValue({});
});

describe("installation ownership repository", () => {
  it("atomically reserves an unclaimed installation for the first verified Google identity", async () => {
    const record = await claimInstallationOwner(
      { googleSub: "google-sub-1", email: "OWNER@example.com" },
      new Date("2026-08-15T01:00:00.000Z"),
    );

    expect(record).toEqual({
      ownerGoogleSub: "google-sub-1",
      ownerEmail: "owner@example.com",
      setupStatus: "CLAIMED",
      createdAt: "2026-08-15T01:00:00.000Z",
      updatedAt: "2026-08-15T01:00:00.000Z",
    });
    expect(batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "bootstrap-sheet",
      requestBody: {
        requests: expect.arrayContaining([
          expect.objectContaining({ addNamedRange: expect.objectContaining({ namedRange: expect.objectContaining({ name: "installation_owner_claim" }) }) }),
          expect.objectContaining({ updateCells: expect.any(Object) }),
        ]),
      },
    });
  });

  it("returns the existing record when the same owner repeats the callback", async () => {
    valuesGet.mockResolvedValue({ data: { values: [["owner_google_sub", "owner_email", "setup_status", "created_at", "updated_at"], existingOwner] } });

    await expect(claimInstallationOwner({ googleSub: "google-sub-1", email: "owner@example.com" })).resolves.toEqual({
      ownerGoogleSub: "google-sub-1",
      ownerEmail: "owner@example.com",
      setupStatus: "CLAIMED",
      createdAt: "2026-08-15T01:00:00.000Z",
      updatedAt: "2026-08-15T01:00:00.000Z",
    });
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("rejects a competing Google identity without replacing the owner", async () => {
    valuesGet.mockResolvedValue({ data: { values: [["owner_google_sub", "owner_email", "setup_status", "created_at", "updated_at"], existingOwner] } });

    await expect(claimInstallationOwner({ googleSub: "different-sub", email: "other@example.com" })).rejects.toThrow("This installation already has an owner.");
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("advances setup status without changing owner identity", async () => {
    valuesGet.mockResolvedValue({ data: { values: [["owner_google_sub", "owner_email", "setup_status", "created_at", "updated_at"], existingOwner] } });

    const result = await setInstallationStatus("google-sub-1", "WORKSPACE_CONNECTED", new Date("2026-08-15T02:00:00.000Z"));

    expect(result.setupStatus).toBe("WORKSPACE_CONNECTED");
    expect(valuesUpdate).toHaveBeenCalledWith({
      spreadsheetId: "bootstrap-sheet",
      range: "Installation!C2:E2",
      valueInputOption: "RAW",
      requestBody: { values: [["WORKSPACE_CONNECTED", "2026-08-15T01:00:00.000Z", "2026-08-15T02:00:00.000Z"]] },
    });
  });

  it("returns null when the key safe has not been claimed", async () => {
    await expect(getInstallation()).resolves.toBeNull();
  });
});
