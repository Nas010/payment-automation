export type LineFetch = (input: string, init?: RequestInit) => Promise<Response>;

type LineProfileInput = { channelAccessToken: string; userId: string; fetchFn: LineFetch };
type LineReplyInput = { channelAccessToken: string; replyToken: string; text: string; fetchFn: LineFetch };

function authorization(channelAccessToken: string): HeadersInit {
  return { Authorization: `Bearer ${channelAccessToken}` };
}

export async function getLineProfile({ channelAccessToken, userId, fetchFn }: LineProfileInput): Promise<{ displayName: string }> {
  try {
    const response = await fetchFn(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, { headers: authorization(channelAccessToken) });
    if (!response.ok) throw new Error("LINE profile response was not successful");
    const profile: unknown = await response.json();
    if (!profile || typeof profile !== "object" || typeof (profile as { displayName?: unknown }).displayName !== "string") throw new Error("LINE profile was malformed");
    return { displayName: (profile as { displayName: string }).displayName };
  } catch {
    throw new Error("LINE profile request failed");
  }
}

export async function replyLineMessage({ channelAccessToken, replyToken, text, fetchFn }: LineReplyInput): Promise<void> {
  try {
    const response = await fetchFn("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { ...authorization(channelAccessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
    if (!response.ok) throw new Error("LINE reply response was not successful");
  } catch {
    throw new Error("LINE reply request failed");
  }
}
