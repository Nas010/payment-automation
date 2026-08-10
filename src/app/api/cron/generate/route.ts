import { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { generateDuePaymentLinks } from "@/lib/payments/generate";
import { reconcileManualConfirmations } from "@/lib/sheets/payments";

export async function GET(request: NextRequest): Promise<Response> {
  const config = serverConfig();
  if (!config.cronSecret || request.headers.get("authorization") !== `Bearer ${config.cronSecret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [generated, reconciled] = await Promise.all([generateDuePaymentLinks({ baseUrl: config.baseUrl || request.nextUrl.origin }), reconcileManualConfirmations()]);
  return Response.json({ created: generated.created.length, existing: generated.existing.length, failed: generated.failed, manual_confirmations_reconciled: reconciled });
}
