import { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { generateMonthlyPayments } from "@/lib/payments/generate";

function currentPeriod(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7); }

export async function POST(request: NextRequest): Promise<Response> {
  const config = serverConfig();
  if (!config.adminSecret || request.headers.get("x-admin-secret") !== config.adminSecret) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { period?: string };
  const created = await generateMonthlyPayments(body.period ?? currentPeriod(), config.baseUrl || request.nextUrl.origin);
  return Response.json({ created: created.map((payment) => ({ payment_id: payment.payment_id, payment_url: payment.payment_url, line_message: payment.line_message })) });
}
