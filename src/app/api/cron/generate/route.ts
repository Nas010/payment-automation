import { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { generateDuePaymentLinks } from "@/lib/payments/generate";
import { reconcileManualConfirmations } from "@/lib/sheets/payments";
import { sendDueLinePaymentRequests } from "@/lib/line/due-payments";

export async function GET(request: NextRequest): Promise<Response> {
  const config = serverConfig();
  if (!config.cronSecret || request.headers.get("authorization") !== `Bearer ${config.cronSecret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const baseUrl = config.baseUrl || request.nextUrl.origin;
  const generated = await generateDuePaymentLinks({ baseUrl });
  const reconciled = await reconcileManualConfirmations();
  const line = await sendDueLinePaymentRequests({ baseUrl });
  return Response.json({ created: generated.created.length, existing: generated.existing.length, failed: generated.failed.length, manual_confirmations_reconciled: reconciled, line });
}
