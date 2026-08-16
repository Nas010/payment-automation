import { getLineChannelAccessToken, getLineChannelSecret } from "@/lib/secrets/service";
import { listClients, updateLineLinkClient } from "@/lib/sheets/clients";
import { getLineProfile } from "@/lib/line/client";
import { persistLineProfile } from "@/lib/line/profile";
import { processLineSlipEvent, type LineSlipEvent } from "@/lib/line/slip-payments";
import { verifyLineSignature } from "@/lib/line/signature";
import { runtimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 60;

const LINE_USER_ID_PATTERN = /^U[a-f0-9]{32}$/;
type LineEvent = { type?: unknown; webhookEventId?: unknown; replyToken?: unknown; source?: unknown; message?: unknown };
type DirectProfileEvent = { lineUserId: string };

function directProfileEvent(value: unknown): DirectProfileEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as LineEvent;
  if (event.type !== "follow" && event.type !== "message") return null;
  const source = event.source;
  if (!source || typeof source !== "object" || (source as { type?: unknown }).type !== "user") return null;
  const lineUserId = (source as { userId?: unknown }).userId;
  return typeof lineUserId === "string" && LINE_USER_ID_PATTERN.test(lineUserId) ? { lineUserId } : null;
}

function directImageEvent(value: unknown): LineSlipEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as LineEvent;
  if (event.type !== "message") return null;
  const source = event.source;
  const message = event.message;
  if (!source || typeof source !== "object" || (source as { type?: unknown }).type !== "user") return null;
  const lineUserId = (source as { userId?: unknown }).userId;
  if (typeof lineUserId !== "string" || !LINE_USER_ID_PATTERN.test(lineUserId)) return null;
  if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "image") return null;
  const messageId = (message as { id?: unknown }).id;
  if (typeof messageId !== "string" || !messageId) return null;
  if (typeof event.replyToken !== "string" || !event.replyToken) return null;
  return { webhookEventId: typeof event.webhookEventId === "string" ? event.webhookEventId : "", replyToken: event.replyToken, lineUserId, messageId };
}

async function refreshLineProfile(lineUserId: string, channelAccessToken: string): Promise<void> {
  let profile: { displayName: string; pictureUrl: string; pictureUrlStatus: "present" | "missing" | "rejected" };
  try {
    profile = await getLineProfile({ channelAccessToken, userId: lineUserId, fetchFn: fetch });
  } catch {
    console.warn("[line-webhook] profile_refresh outcome=profile_lookup_failed");
    return;
  }

  try {
    const persisted = await persistLineProfile({ listClients, updateLineLinkClient }, { lineUserId, displayName: profile.displayName, pictureUrl: profile.pictureUrl, now: new Date() });
    if (persisted) console.info(`[line-webhook] profile_refresh outcome=updated image=${profile.pictureUrlStatus}`);
    else console.warn("[line-webhook] profile_refresh outcome=skipped");
  } catch {
    console.warn("[line-webhook] profile_refresh outcome=persistence_failed");
  }
}

async function processProfileEvent(event: DirectProfileEvent): Promise<void> {
  let channelAccessToken: string;
  try {
    channelAccessToken = await getLineChannelAccessToken();
  } catch {
    console.warn("[line-webhook] profile_refresh outcome=profile_lookup_failed");
    return;
  }
  await refreshLineProfile(event.lineUserId, channelAccessToken);
}

export async function POST(request: Request): Promise<Response> {
  let config;
  try { config = await runtimeConfig(); } catch { return new Response("Not Found", { status: 404 }); }
  if (!config.lineLinkingEnabled) return new Response("Not Found", { status: 404 });

  const rawBody = await request.text();
  let channelSecret: string;
  try {
    channelSecret = await getLineChannelSecret();
  } catch {
    return new Response("Internal Server Error", { status: 500 });
  }

  if (!verifyLineSignature(rawBody, request.headers.get("x-line-signature"), channelSecret)) return new Response("Unauthorized", { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const events = payload && typeof payload === "object" && Array.isArray((payload as { events?: unknown }).events) ? (payload as { events: unknown[] }).events : [];
  for (const value of events) {
    const imageEvent = directImageEvent(value);
    if (imageEvent) {
      try {
        await processLineSlipEvent(imageEvent);
      } catch {
        // One event failure must not make LINE retry a successfully signed batch.
      }
    }
    const profileEvent = directProfileEvent(value);
    if (profileEvent) await processProfileEvent(profileEvent);
  }
  return new Response(null, { status: 200 });
}
