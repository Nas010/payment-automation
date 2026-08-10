import { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { generateMonthlyPayments } from "@/lib/payments/generate";

export async function GET(request: NextRequest): Promise<Response> {
  const config = serverConfig();
  if (!config.cronSecret || request.headers.get("authorization") !== `Bearer ${config.cronSecret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const period = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const created = await generateMonthlyPayments(period, config.baseUrl || request.nextUrl.origin);
  return Response.json({ created: created.length });
}
