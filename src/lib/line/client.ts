import { normalizeLinePictureUrl } from "./profile";

export type LineFetch = (input: string, init?: RequestInit) => Promise<Response>;

type LineProfileInput = { channelAccessToken: string; userId: string; fetchFn: LineFetch };
type LineReplyInput = { channelAccessToken: string; replyToken: string; text: string; fetchFn: LineFetch };
type LineMessage = { type: string; [key: string]: unknown };
type LinePushInput = { channelAccessToken: string; to: string; messages: LineMessage[]; retryKey: string; fetchFn: LineFetch };
type LineReplyMessagesInput = { channelAccessToken: string; replyToken: string; messages: LineMessage[]; fetchFn: LineFetch };
type LineContentInput = { channelAccessToken: string; messageId: string; fetchFn: LineFetch; signal?: AbortSignal };

const MAX_MESSAGE_CONTENT_BYTES = 10 * 1024 * 1024;

function authorization(channelAccessToken: string): HeadersInit {
  return { Authorization: `Bearer ${channelAccessToken}` };
}

function imageMimeType(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  return null;
}

export async function getLineProfile({ channelAccessToken, userId, fetchFn }: LineProfileInput): Promise<{ displayName: string; pictureUrl: string }> {
  try {
    const response = await fetchFn(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, { headers: authorization(channelAccessToken) });
    if (!response.ok) throw new Error("LINE profile response was not successful");
    const profile: unknown = await response.json();
    if (!profile || typeof profile !== "object" || typeof (profile as { displayName?: unknown }).displayName !== "string") throw new Error("LINE profile was malformed");
    return { displayName: (profile as { displayName: string }).displayName, pictureUrl: normalizeLinePictureUrl((profile as { pictureUrl?: unknown }).pictureUrl) };
  } catch {
    throw new Error("LINE profile request failed");
  }
}

export async function sendLinePushMessage({ channelAccessToken, to, messages, retryKey, fetchFn }: LinePushInput): Promise<{ accepted: boolean; retryable: boolean; requestId: string; errorCode: string }> {
  try {
    const response = await fetchFn("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { ...authorization(channelAccessToken), "Content-Type": "application/json", "X-Line-Retry-Key": retryKey },
      body: JSON.stringify({ to, messages }),
    });
    if (response.ok) return { accepted: true, retryable: false, requestId: response.headers.get("x-line-request-id") ?? "", errorCode: "" };
    const acceptedRequestId = response.headers.get("x-line-accepted-request-id");
    if (response.status === 409 && acceptedRequestId) return { accepted: true, retryable: false, requestId: acceptedRequestId, errorCode: "" };
    const errorCode = `HTTP_${response.status}`;
    return { accepted: false, retryable: response.status === 429 || response.status >= 500, requestId: "", errorCode };
  } catch {
    return { accepted: false, retryable: true, requestId: "", errorCode: "NETWORK_ERROR" };
  }
}

export async function sendLineReplyMessage({ channelAccessToken, replyToken, messages, fetchFn }: LineReplyMessagesInput): Promise<void> {
  try {
    const response = await fetchFn("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { ...authorization(channelAccessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ replyToken, messages }),
    });
    if (!response.ok) throw new Error("LINE reply response was not successful");
  } catch {
    throw new Error("LINE reply request failed");
  }
}

export async function replyLineMessage({ channelAccessToken, replyToken, text, fetchFn }: LineReplyInput): Promise<void> {
  await sendLineReplyMessage({ channelAccessToken, replyToken, messages: [{ type: "text", text }], fetchFn });
}

export async function getLineMessageContent({ channelAccessToken, messageId, fetchFn, signal }: LineContentInput): Promise<{ bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" }> {
  try {
    const response = await fetchFn(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, { headers: authorization(channelAccessToken), signal: signal ?? AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("LINE content response was not successful");
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > MAX_MESSAGE_CONTENT_BYTES) throw new Error("LINE content response was too large");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_MESSAGE_CONTENT_BYTES) throw new Error("LINE content response was too large");
    const mimeType = imageMimeType(bytes);
    if (!mimeType) throw new Error("LINE content response was not an image");
    return { bytes, mimeType };
  } catch {
    throw new Error("LINE message content request failed");
  }
}
