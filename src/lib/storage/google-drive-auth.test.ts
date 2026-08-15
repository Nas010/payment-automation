import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthNonce, createOAuthState, createPkceChallenge, createPkceVerifier, googleDriveScopes, isEqualOAuthState, verifyGoogleIdentity } from "./google-drive-auth";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
beforeEach(() => {
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
});

describe("Google Drive OAuth primitives", () => {
  it("uses the narrow Drive scope plus identity scopes", () => {
    expect(googleDriveScopes).toEqual(["https://www.googleapis.com/auth/drive.file", "openid", "email"]);
  });

  it("creates random state and PKCE verifier values", () => {
    expect(createOAuthState()).toHaveLength(43);
    expect(createOAuthNonce()).toHaveLength(43);
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

  it("accepts only a verified ID token with matching nonce and audience", async () => {
    const client = {
      verifyIdToken: vi.fn().mockResolvedValue({ getPayload: () => ({ sub: "google-sub-1", email: "OWNER@example.com", email_verified: true, nonce: "nonce-value" }) }),
    };

    await expect(verifyGoogleIdentity(client as never, {
      idToken: "id-token",
      expectedNonce: "nonce-value",
      clientId: "oauth-client-id",
    })).resolves.toEqual({ googleSub: "google-sub-1", email: "owner@example.com" });
    expect(client.verifyIdToken).toHaveBeenCalledWith({ idToken: "id-token", audience: "oauth-client-id" });
  });

  it("rejects an ID token with an invalid nonce or unverified email", async () => {
    const invalidNonce = { verifyIdToken: vi.fn().mockResolvedValue({ getPayload: () => ({ sub: "sub", email: "owner@example.com", email_verified: true, nonce: "wrong" }) }) };
    const unverifiedEmail = { verifyIdToken: vi.fn().mockResolvedValue({ getPayload: () => ({ sub: "sub", email: "owner@example.com", email_verified: false, nonce: "nonce" }) }) };

    await expect(verifyGoogleIdentity(invalidNonce as never, { idToken: "token", expectedNonce: "nonce", clientId: "client" })).rejects.toThrow("Google identity could not be verified.");
    await expect(verifyGoogleIdentity(unverifiedEmail as never, { idToken: "token", expectedNonce: "nonce", clientId: "client" })).rejects.toThrow("Google identity could not be verified.");
  });
});
