import { afterEach, describe, expect, it, vi } from "vitest";
import { getLineMessageContent, getLineProfile, replyLineMessage, sendLinePushMessage, sendLineReplyMessage } from "./client";

const token = "access-token-which-is-never-logged";

afterEach(() => vi.restoreAllMocks());

describe("LINE HTTP client", () => {
  it("gets a profile with Bearer authentication and returns trusted display fields", async () => {
    const pictureUrl = "https://profile.line-scdn.net/avatar/path";
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ displayName: "Nisa", userId: "Uprivate", pictureUrl }), { status: 200 }));

    await expect(getLineProfile({ channelAccessToken: token, userId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fetchFn })).resolves.toEqual({ displayName: "Nisa", pictureUrl, pictureUrlStatus: "present" });
    expect(fetchFn).toHaveBeenCalledWith("https://api.line.me/v2/bot/profile/Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { headers: { Authorization: `Bearer ${token}` } });
  });

  it("preserves a valid HTTPS profile image returned by LINE", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ displayName: "Nisa", userId: "Uprivate", pictureUrl: "https://attacker.example/avatar" }), { status: 200 }));

    await expect(getLineProfile({ channelAccessToken: token, userId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fetchFn })).resolves.toEqual({ displayName: "Nisa", pictureUrl: "https://attacker.example/avatar", pictureUrlStatus: "present" });
  });

  it("identifies an omitted LINE profile image without exposing profile data", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ displayName: "Nisa", userId: "Uprivate" }), { status: 200 }));

    await expect(getLineProfile({ channelAccessToken: token, userId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fetchFn })).resolves.toEqual({ displayName: "Nisa", pictureUrl: "", pictureUrlStatus: "missing" });
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

  it("sends a push with its stable retry key and returns the accepted request ID", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 202, headers: { "x-line-request-id": "request_1" } }));

    await expect(sendLinePushMessage({ channelAccessToken: token, to: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", messages: [{ type: "text", text: "Payment due" }], retryKey: "retry_1", fetchFn })).resolves.toEqual({ accepted: true, retryable: false, requestId: "request_1", errorCode: "" });
    expect(fetchFn).toHaveBeenCalledWith("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Line-Retry-Key": "retry_1" },
      body: JSON.stringify({ to: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", messages: [{ type: "text", text: "Payment due" }] }),
    });
  });

  it("recognizes LINE's accepted duplicate response", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 409, headers: { "x-line-accepted-request-id": "request_already_accepted" } }));

    await expect(sendLinePushMessage({ channelAccessToken: token, to: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", messages: [{ type: "text", text: "Payment due" }], retryKey: "retry_1", fetchFn })).resolves.toEqual({ accepted: true, retryable: false, requestId: "request_already_accepted", errorCode: "" });
  });

  it.each([429, 500, 503])("marks HTTP %i push failures retryable without reading remote body", async (status) => {
    const fetchFn = vi.fn(async () => new Response("private upstream failure", { status }));

    await expect(sendLinePushMessage({ channelAccessToken: token, to: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", messages: [{ type: "text", text: "Payment due" }], retryKey: "retry_1", fetchFn })).resolves.toEqual({ accepted: false, retryable: true, requestId: "", errorCode: `HTTP_${status}` });
  });

  it("marks ambiguous network failures retryable", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("private network failure"); });

    await expect(sendLinePushMessage({ channelAccessToken: token, to: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", messages: [{ type: "text", text: "Payment due" }], retryKey: "retry_1", fetchFn })).resolves.toEqual({ accepted: false, retryable: true, requestId: "", errorCode: "NETWORK_ERROR" });
  });

  it("returns sanitized permanent push failures", async () => {
    const fetchFn = vi.fn(async () => new Response("private upstream failure", { status: 400 }));

    const result = await sendLinePushMessage({ channelAccessToken: token, to: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", messages: [{ type: "text", text: "Payment due" }], retryKey: "retry_1", fetchFn });
    expect(result).toEqual({ accepted: false, retryable: false, requestId: "", errorCode: "HTTP_400" });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("sends reply message arrays with shared authorization", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));

    await expect(sendLineReplyMessage({ channelAccessToken: token, replyToken: "reply-token", messages: [{ type: "text", text: "Linked." }], fetchFn })).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledWith("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replyToken: "reply-token", messages: [{ type: "text", text: "Linked." }] }),
    });
  });

  it("downloads JPEG content with bearer authentication and the documented 10-second default timeout", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    const defaultSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(defaultSignal);

    await expect(getLineMessageContent({ channelAccessToken: token, messageId: "message_1", fetchFn })).resolves.toEqual({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]), mimeType: "image/jpeg" });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchFn).toHaveBeenCalledWith("https://api-data.line.me/v2/bot/message/message_1/content", expect.objectContaining({ headers: { Authorization: `Bearer ${token}` }, signal: defaultSignal }));
  });

  it("preserves a caller-provided content timeout signal", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), { status: 200 }));
    const callerSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await expect(getLineMessageContent({ channelAccessToken: token, messageId: "message_1", fetchFn, signal: callerSignal })).resolves.toMatchObject({ mimeType: "image/jpeg" });

    expect(timeout).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledWith("https://api-data.line.me/v2/bot/message/message_1/content", expect.objectContaining({ signal: callerSignal }));
  });

  it("identifies PNG content from its magic bytes", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { status: 200, headers: { "content-type": "application/octet-stream" } }));

    await expect(getLineMessageContent({ channelAccessToken: token, messageId: "message_1", fetchFn })).resolves.toMatchObject({ mimeType: "image/png" });
  });

  it("rejects LINE content before buffering an oversized advertised body", async () => {
    const arrayBuffer = vi.fn();
    const fetchFn = vi.fn(async () => ({ ok: true, headers: new Headers({ "content-length": String(10 * 1024 * 1024 + 1) }), arrayBuffer } as unknown as Response));

    await expect(getLineMessageContent({ channelAccessToken: token, messageId: "message_1", fetchFn })).rejects.toThrow("LINE message content request failed");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects oversized or non-image LINE content after download", async () => {
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(oversized, { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    await expect(getLineMessageContent({ channelAccessToken: token, messageId: "message_1", fetchFn })).rejects.toThrow("LINE message content request failed");
    await expect(getLineMessageContent({ channelAccessToken: token, messageId: "message_2", fetchFn })).rejects.toThrow("LINE message content request failed");
  });
});
