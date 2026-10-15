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
  const failedStages: string[] = [];
  const stages: Array<{ stage: string; elapsedMs: number; failed: boolean }> = [];
  const run = async <T,>(stage: string, operation: () => Promise<T>, fallback: T): Promise<T> => {
    const startedAt = Date.now();
    let failed = false;
    try {
      return await operation();
    } catch {
      failed = true;
      failedStages.push(stage);
      return fallback;
    } finally {
      stages.push({ stage, elapsedMs: Date.now() - startedAt, failed });
      console.info("PAYMENT_CRON_STAGE", stages[stages.length - 1]);
    }
  };
  const generated = await run("generate", () => generateDuePaymentLinks({ baseUrl }), { created: [], existing: [], failed: [] });
  const reconciled = await run("reconcile", reconcileManualConfirmations, 0);
  // Process time-sensitive reminder slots before potentially expensive overdue-payment retries.
  const reminders = await run("reminders", () => sendInstallmentReminderRequests({ baseUrl }), []);
  const line = await run("due_payments", () => sendDueLinePaymentRequests({ baseUrl }), {
    accepted: [], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false,
  });
  return Response.json({ created: generated.created.length, existing: generated.existing.length, failed: generated.failed.length, manual_confirmations_reconciled: reconciled, line, reminders, failed_stages: failedStages }, { status: failedStages.length || generated.failed.length ? 503 : 200 });
}
