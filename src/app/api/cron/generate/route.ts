import { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { generateMonthlyPayments } from "@/lib/payments/generate";
import { reconcileManualConfirmations } from "@/lib/sheets/payments";

export async function GET(request: NextRequest): Promise<Response> {
  const config = serverConfig();
  if (!config.cronSecret || request.headers.get("authorization") !== `Bearer ${config.cronSecret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const period = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const [created, reconciled] = await Promise.all([generateMonthlyPayments(period, config.baseUrl || request.nextUrl.origin), reconcileManualConfirmations()]);
  return Response.json({ created: created.length, manual_confirmations_reconciled: reconciled });
}
