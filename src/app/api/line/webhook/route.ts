import { getLineChannelAccessToken, getLineChannelSecret } from "@/lib/secrets/service";
import { appendAudit } from "@/lib/sheets/payments";
import { getLineAutomaticReplyConfig } from "@/lib/sheets/settings";
import { claimLineLink, listClients, updateClient, updateLineLinkClient } from "@/lib/sheets/clients";
import { getLineProfile, replyLineMessage } from "@/lib/line/client";
import { parseLineLinkCommand } from "@/lib/line/link-command";
import { createLineLinkService, type LinkResult } from "@/lib/line/linking";
import { DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG, lineConnectionReplyText, type LineAutomaticReplyConfig } from "@/lib/line/reply-config";
import { processLineSlipEvent, type LineSlipEvent } from "@/lib/line/slip-payments";
import { verifyLineSignature } from "@/lib/line/signature";
import { runtimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

const LINE_USER_ID_PATTERN = /^U[a-f0-9]{32}$/;
type LineEvent = { type?: unknown; webhookEventId?: unknown; replyToken?: unknown; source?: unknown; message?: unknown };
type DirectLinkEvent = { webhookEventId: string; replyToken: string; lineUserId: string; code: string };
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

function directLinkEvent(value: unknown): DirectLinkEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as LineEvent;
  if (event.type !== "message") return null;
  const source = event.source;
  const message = event.message;
  if (!source || typeof source !== "object" || (source as { type?: unknown }).type !== "user") return null;
  const lineUserId = (source as { userId?: unknown }).userId;
  if (typeof lineUserId !== "string" || !LINE_USER_ID_PATTERN.test(lineUserId)) return null;
  if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "text") return null;
  const text = (message as { text?: unknown }).text;
  if (typeof text !== "string") return null;
  const code = parseLineLinkCommand(text);
  if (!code) return null;
  if (typeof event.replyToken !== "string" || !event.replyToken) return null;
  return { webhookEventId: typeof event.webhookEventId === "string" ? event.webhookEventId : "", replyToken: event.replyToken, lineUserId, code };
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

async function auditReplyFailure(event: DirectLinkEvent): Promise<void> {
  try {
    await appendAudit({
      paymentId: "",
      clientId: "",
      action: "LINE_LINK_REPLY_FAILED",
      previousStatus: "",
      newStatus: "",
      reason: "LINE reply failed",
      source: "LINE_WEBHOOK",
      metadata: JSON.stringify({ ...(event.webhookEventId ? { webhookEventId: event.webhookEventId } : {}), lineUserSuffix: event.lineUserId.slice(-4) }),
    });
  } catch {
    // A best-effort audit must not make a signed webhook retry a successful link.
  }
}

async function processEvent(event: DirectLinkEvent, automaticReplyConfig: LineAutomaticReplyConfig): Promise<void> {
  const service = createLineLinkService({ listClients, updateClient, updateLineLinkClient, claimLineLink, appendAudit });
  let result: LinkResult;
  try {
    result = await service.linkLineUser({ code: event.code, lineUserId: event.lineUserId, now: new Date(), webhookEventId: event.webhookEventId });
  } catch {
    return;
  }

  let channelAccessToken: string;
  try {
    channelAccessToken = await getLineChannelAccessToken();
  } catch {
    await auditReplyFailure(event);
    return;
  }

  if (result === "LINKED" || result === "ALREADY_LINKED") {
    await refreshLineProfile(service, event.lineUserId, channelAccessToken);
  }

  try {
    await replyLineMessage({ channelAccessToken, replyToken: event.replyToken, text: lineConnectionReplyText(automaticReplyConfig, result), fetchFn: fetch });
  } catch {
    await auditReplyFailure(event);
  }
}

async function refreshLineProfile(service: ReturnType<typeof createLineLinkService>, lineUserId: string, channelAccessToken: string): Promise<void> {
  let profile: { displayName: string; pictureUrl: string; pictureUrlStatus: "present" | "missing" | "rejected" };
  try {
    profile = await getLineProfile({ channelAccessToken, userId: lineUserId, fetchFn: fetch });
  } catch {
    console.warn("[line-webhook] profile_refresh outcome=profile_lookup_failed");
    return;
  }

  try {
    const persisted = await service.persistLineProfile({ lineUserId, displayName: profile.displayName, pictureUrl: profile.pictureUrl, now: new Date() });
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
  const service = createLineLinkService({ listClients, updateClient, updateLineLinkClient, claimLineLink, appendAudit });
  await refreshLineProfile(service, event.lineUserId, channelAccessToken);
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
  let automaticReplyConfig = DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG;
  if (events.some((value) => directLinkEvent(value) !== null)) {
    try {
      automaticReplyConfig = await getLineAutomaticReplyConfig();
    } catch {
      automaticReplyConfig = DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG;
    }
  }
  for (const value of events) {
    const linkEvent = directLinkEvent(value);
    if (linkEvent) {
      try {
        await processEvent(linkEvent, automaticReplyConfig);
      } catch {
        // One event failure must not make LINE retry a successfully signed batch.
      }
      continue;
    }
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
