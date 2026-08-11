import { getLineChannelAccessToken, getLineChannelSecret } from "@/lib/secrets/service";
import { appendAudit } from "@/lib/sheets/payments";
import { claimLineLink, listClients, updateClient, updateLineLinkClient } from "@/lib/sheets/clients";
import { getLineProfile, replyLineMessage } from "@/lib/line/client";
import { parseLineLinkCommand } from "@/lib/line/link-command";
import { createLineLinkService, type LinkResult } from "@/lib/line/linking";
import { processLineSlipEvent, type LineSlipEvent } from "@/lib/line/slip-payments";
import { verifyLineSignature } from "@/lib/line/signature";
import { lineLinkingEnabled } from "@/lib/config";

export const runtime = "nodejs";

const LINE_USER_ID_PATTERN = /^U[a-f0-9]{32}$/;
const REPLY_TEXT: Record<LinkResult, string> = {
  LINKED: "✓ Connected\n\nYour coaching account is now linked. Future payment links can be sent here automatically.",
  ALREADY_LINKED: "✓ Already connected\n\nThis LINE account is already linked to your coaching account.",
  INVALID_OR_EXPIRED: "I couldn't connect this account. The code is invalid or expired. Please ask your trainer for a new code.",
  CLIENT_INACTIVE: "I couldn't connect this account. The code is invalid or expired. Please ask your trainer for a new code.",
  CONFLICT: "I couldn't connect this account automatically. Please contact your trainer so they can check the existing connection.",
};

type LineEvent = { type?: unknown; webhookEventId?: unknown; replyToken?: unknown; source?: unknown; message?: unknown };
type DirectLinkEvent = { webhookEventId: string; replyToken: string; lineUserId: string; code: string };

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

async function processEvent(event: DirectLinkEvent): Promise<void> {
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

  if (result === "LINKED") {
    try {
      const profile = await getLineProfile({ channelAccessToken, userId: event.lineUserId, fetchFn: fetch });
      await service.persistLineDisplayName({ lineUserId: event.lineUserId, displayName: profile.displayName, now: new Date() });
    } catch {
      // Profile enrichment is best effort and must never roll back a completed link.
    }
  }

  try {
    await replyLineMessage({ channelAccessToken, replyToken: event.replyToken, text: REPLY_TEXT[result], fetchFn: fetch });
  } catch {
    await auditReplyFailure(event);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!lineLinkingEnabled()) return new Response("Not Found", { status: 404 });

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
    const linkEvent = directLinkEvent(value);
    if (linkEvent) {
      try {
        await processEvent(linkEvent);
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
  }
  return new Response(null, { status: 200 });
}
