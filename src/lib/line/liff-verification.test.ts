import { describe, expect, it, vi } from "vitest";
import { LineIdTokenVerificationError, verifyLineIdToken } from "./liff-verification";

const idToken = "header.payload.signature";
const channelId = "1234567890";
const lineUserId = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const now = new Date("2026-08-15T12:00:00.000Z");

function verified(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://access.line.me",
    sub: lineUserId,
    aud: channelId,
    exp: Math.floor(now.getTime() / 1000) + 600,
    iat: Math.floor(now.getTime() / 1000) - 10,
    name: "Nisa LINE",
    ...overrides,
  };
}

describe("LINE LIFF ID-token verification", () => {
  it("verifies the raw token through LINE and returns only trusted identity claims", async () => {
    const pictureUrl = "https://profile.line-scdn.net/avatar/path";
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(verified({ picture: pictureUrl, email: "private@example.test" })), { status: 200 }));

    await expect(verifyLineIdToken({ idToken, channelId, now, fetchFn })).resolves.toEqual({ lineUserId, displayName: "Nisa LINE", pictureUrl });
    expect(fetchFn).toHaveBeenCalledWith("https://api.line.me/oauth2/v2.1/verify", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
    }));
  });

  it("does not trust a picture URL outside LINE's profile CDN", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(verified({ picture: "https://attacker.example/avatar" })), { status: 200 }));

    await expect(verifyLineIdToken({ idToken, channelId, now, fetchFn })).resolves.toMatchObject({ pictureUrl: "" });
  });

  it.each([
    ["wrong audience", { aud: "9999999999" }],
    ["wrong issuer", { iss: "https://attacker.example" }],
    ["expired", { exp: Math.floor(now.getTime() / 1000) - 1 }],
    ["malformed subject", { sub: "Ushort" }],
  ])("rejects %s claims even after a 200 response", async (_label, overrides) => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(verified(overrides)), { status: 200 }));

    await expect(verifyLineIdToken({ idToken, channelId, now, fetchFn })).rejects.toMatchObject({ code: "INVALID" });
  });

  it("treats LINE rejection as invalid and transport failure as temporary without leaking token", async () => {
    const rejected = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid token" }), { status: 400 }));
    const unavailable = vi.fn().mockRejectedValue(new Error(`network failed for ${idToken}`));

    await expect(verifyLineIdToken({ idToken, channelId, now, fetchFn: rejected })).rejects.toMatchObject({ code: "INVALID" });
    await expect(verifyLineIdToken({ idToken, channelId, now, fetchFn: unavailable })).rejects.toMatchObject({ code: "TEMPORARY" });
    try {
      await verifyLineIdToken({ idToken, channelId, now, fetchFn: unavailable });
    } catch (error) {
      expect(error).toBeInstanceOf(LineIdTokenVerificationError);
      expect(String(error)).not.toContain(idToken);
    }
  });
});
