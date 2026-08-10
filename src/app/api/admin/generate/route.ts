import { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";
import { generateDuePaymentLinks } from "@/lib/payments/generate";

export async function POST(request: NextRequest): Promise<Response> {
  const config = serverConfig();
  if (!config.adminSecret || request.headers.get("x-admin-secret") !== config.adminSecret) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const generated = await generateDuePaymentLinks({ baseUrl: config.baseUrl || request.nextUrl.origin });
  return Response.json({ created: generated.created.map((payment) => ({ payment_id: payment.payment_id, payment_url: payment.payment_url, line_message: payment.line_message })), existing: generated.existing.length, failed: generated.failed });
}
