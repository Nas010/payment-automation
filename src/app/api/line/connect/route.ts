import { z } from "zod";
import { createLineConnectionService } from "@/lib/line/connection";
import { LineIdTokenVerificationError, verifyLineIdToken } from "@/lib/line/liff-verification";
import { runtimeConfig } from "@/lib/runtime-config";
import { lineConnectionLimiter } from "@/lib/security/rate-limit";
import { claimLineConnection, listClients, updateLineLinkClient } from "@/lib/sheets/clients";
import { appendAudit } from "@/lib/sheets/payments";

export const runtime = "nodejs";

const bodySchema = z.object({
  idToken: z.string().min(10).max(4096).regex(/^[^\s]+\.[^\s]+\.[^\s]+$/),
  connectionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();

function json(status: string, responseStatus: number): Response {
  return Response.json({ status }, { status: responseStatus, headers: { "Cache-Control": "no-store" } });
}

function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request): Promise<Response> {
  let lineLoginChannelId = "";
  try {
    const config = await runtimeConfig();
    if (!config.lineLinkingEnabled) return new Response("Not Found", { status: 404 });
    lineLoginChannelId = config.lineLoginChannelId;
  } catch {
    return json("temporary_failure", 503);
  }
  if (!lineLoginChannelId) return json("temporary_failure", 503);

  let parsed;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return json("invalid", 400);
  }
  if (!lineConnectionLimiter.allow(clientAddress(request))) return json("temporary_failure", 429);

  let identity;
  try {
    identity = await verifyLineIdToken({ idToken: parsed.idToken, channelId: lineLoginChannelId, fetchFn: fetch });
  } catch (error) {
    if (error instanceof LineIdTokenVerificationError && error.code === "INVALID") return json("invalid", 401);
    return json("temporary_failure", 503);
  }

  try {
    const service = createLineConnectionService({ listClients, updateLineLinkClient, claimLineConnection, appendAudit });
    const result = await service.claim({ token: parsed.connectionToken, lineUserId: identity.lineUserId, displayName: identity.displayName, now: new Date() });
    if (result === "LINKED") return json("success", 200);
    if (result === "ALREADY_LINKED") return json("already_used", 200);
    if (result === "CONFLICT") return json("conflict", 409);
    return json("expired", 410);
  } catch {
    return json("temporary_failure", 503);
  }
}
