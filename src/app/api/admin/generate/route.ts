import { NextRequest } from "next/server";
import { adminSecret } from "@/lib/admin-auth";
import { runtimeConfig } from "@/lib/runtime-config";
import { generateDuePaymentLinks } from "@/lib/payments/generate";

export async function POST(request: NextRequest): Promise<Response> {
  if (request.headers.get("x-admin-secret") !== adminSecret()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let config;
  try { config = await runtimeConfig(); } catch { return Response.json({ error: "Setup incomplete" }, { status: 503 }); }
  const generated = await generateDuePaymentLinks({ baseUrl: config.publicBaseUrl });
  return Response.json({ created: generated.created.map((payment) => ({ payment_id: payment.payment_id, payment_url: payment.payment_url, line_message: payment.line_message })), existing: generated.existing.length, failed: generated.failed });
}
