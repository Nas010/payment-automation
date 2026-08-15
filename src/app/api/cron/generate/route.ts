import { NextRequest } from "next/server";
import { cronSecret } from "@/lib/config";
import { runtimeConfig } from "@/lib/runtime-config";
import { getInstallation } from "@/lib/installation/repository";
import { generateDuePaymentLinks } from "@/lib/payments/generate";
import { reconcileManualConfirmations } from "@/lib/sheets/payments";
import { sendDueLinePaymentRequests } from "@/lib/line/due-payments";
import { sendInstallmentReminderRequests } from "@/lib/line/installment-reminders";

export async function GET(request: NextRequest): Promise<Response> {
  const secret = cronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if ((await getInstallation())?.setupStatus !== "COMPLETE") return Response.json({ error: "Setup incomplete" }, { status: 503 });
  let config;
  try { config = await runtimeConfig(); } catch { return Response.json({ error: "Setup incomplete" }, { status: 503 }); }
  const baseUrl = config.publicBaseUrl;
  const generated = await generateDuePaymentLinks({ baseUrl });
  const reconciled = await reconcileManualConfirmations();
  const line = await sendDueLinePaymentRequests({ baseUrl });
  const reminders = await sendInstallmentReminderRequests({ baseUrl });
  return Response.json({ created: generated.created.length, existing: generated.existing.length, failed: generated.failed.length, manual_confirmations_reconciled: reconciled, line, reminders });
}
