import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthState, createPkceChallenge, createPkceVerifier, decodeDriveCandidate, encodeDriveCandidate, googleDriveScopes, isEqualOAuthState } from "./google-drive-auth";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const candidate = { refreshToken: "refresh-secret", accountEmail: "coach@example.com", folderId: "folder-12345", folderName: "Private slips", validatedAt: "2026-08-11T12:00:00.000Z" };

beforeEach(() => {
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
});

describe("Google Drive OAuth primitives", () => {
  it("uses the narrow Drive scope plus identity scopes", () => {
    expect(googleDriveScopes).toEqual(["https://www.googleapis.com/auth/drive.file", "openid", "email"]);
  });

  it("creates random state and PKCE verifier values", () => {
    expect(createOAuthState()).toHaveLength(43);
    expect(createPkceVerifier()).toHaveLength(86);
  });

  it("creates the deterministic PKCE challenge for a known verifier", () => {
    expect(createPkceChallenge("verifier")).toBe("iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ");
  });

  it("compares OAuth state only when values match exactly", () => {
    expect(isEqualOAuthState("same", "same")).toBe(true);
    expect(isEqualOAuthState("same", "different")).toBe(false);
    expect(isEqualOAuthState(undefined, "same")).toBe(false);
  });

  it("round-trips encrypted candidate authorization without exposing plaintext fields", () => {
    const encoded = encodeDriveCandidate(candidate);
    expect(encoded).not.toContain(candidate.refreshToken);
    expect(encoded).not.toContain(candidate.folderId);
    expect(decodeDriveCandidate(encoded)).toEqual(candidate);
  });

  it("rejects malformed candidate cookies", () => {
    expect(() => decodeDriveCandidate("not-a-candidate")).toThrow("Google Drive connection is invalid.");
  });
});
