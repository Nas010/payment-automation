import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/secrets/crypto";

const mocks = vi.hoisted(() => ({ getSecretRecord: vi.fn(), upsertSecretRecord: vi.fn() }));

vi.mock("@/lib/secrets/repository", () => ({ getSecretRecord: mocks.getSecretRecord, upsertSecretRecord: mocks.upsertSecretRecord }));

import { getGoogleDriveConnection, googleDriveStatus, saveGoogleDriveConnection } from "./google-drive-connection";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const connection = { refreshToken: "refresh-secret", accountEmail: "coach@example.com", folderId: "folder-12345", folderName: "Private slips", validatedAt: "2026-08-11T12:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
  mocks.getSecretRecord.mockResolvedValue(null);
  mocks.upsertSecretRecord.mockResolvedValue(undefined);
});

describe("Google Drive connection repository", () => {
  it("returns null when no active connection exists", async () => {
    await expect(getGoogleDriveConnection()).resolves.toBeNull();
  });

  it("decrypts and validates an active connection", async () => {
    mocks.getSecretRecord.mockResolvedValue({ keyName: "google_drive_connection", ...encryptSecret({ keyName: "google_drive_connection", plaintext: JSON.stringify(connection), exposeLastFour: false }), rowNumber: 2 });

    await expect(getGoogleDriveConnection()).resolves.toEqual(connection);
  });

  it("rejects malformed active connection payloads", async () => {
    mocks.getSecretRecord.mockResolvedValue({ keyName: "google_drive_connection", ...encryptSecret({ keyName: "google_drive_connection", plaintext: JSON.stringify({ refreshToken: "only-one-field" }), exposeLastFour: false }), rowNumber: 2 });

    await expect(getGoogleDriveConnection()).rejects.toThrow("Google Drive connection is invalid.");
  });

  it("encrypts the complete connection without token suffix metadata", async () => {
    await saveGoogleDriveConnection(connection);

    const persisted = mocks.upsertSecretRecord.mock.calls[0][0];
    expect(persisted).toMatchObject({ keyName: "google_drive_connection", lastFour: "" });
    expect(JSON.stringify(persisted)).not.toContain(connection.refreshToken);
    expect(decryptSecret({ keyName: "google_drive_connection", record: persisted })).toBe(JSON.stringify(connection));
  });

  it("projects safe status without authorization or folder identifiers", () => {
    const status = googleDriveStatus(connection);

    expect(status).toEqual({ connected: true, accountEmail: "coach@example.com", folderName: "Private slips", validatedAt: "2026-08-11T12:00:00.000Z" });
    expect(JSON.stringify(status)).not.toContain("refresh-secret");
    expect(JSON.stringify(status)).not.toContain("folder-12345");
  });
});
