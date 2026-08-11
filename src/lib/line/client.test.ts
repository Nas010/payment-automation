import { describe, expect, it, vi } from "vitest";
import { getLineProfile, replyLineMessage } from "./client";

const token = "access-token-which-is-never-logged";

describe("LINE HTTP client", () => {
  it("gets a profile with Bearer authentication and returns only display name", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ displayName: "Nisa", userId: "Uprivate", pictureUrl: "https://private" }), { status: 200 }));

    await expect(getLineProfile({ channelAccessToken: token, userId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fetchFn })).resolves.toEqual({ displayName: "Nisa" });
    expect(fetchFn).toHaveBeenCalledWith("https://api.line.me/v2/bot/profile/Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { headers: { Authorization: `Bearer ${token}` } });
  });

  it("makes reply request with the LINE reply shape", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));

    await expect(replyLineMessage({ channelAccessToken: token, replyToken: "reply-token", text: "Linked.", fetchFn })).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledWith("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replyToken: "reply-token", messages: [{ type: "text", text: "Linked." }] }),
    });
  });

  it("returns sanitized errors for profile and reply failures", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ message: "private upstream detail" }), { status: 500 }));

    await expect(getLineProfile({ channelAccessToken: token, userId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fetchFn })).rejects.toThrow("LINE profile request failed");
    await expect(replyLineMessage({ channelAccessToken: token, replyToken: "reply-token", text: "Linked.", fetchFn })).rejects.toThrow("LINE reply request failed");
  });
});
