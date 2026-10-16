import { NextRequest } from "next/server";
import { cronSecret } from "@/lib/config";
import { runtimeConfig } from "@/lib/runtime-config";
import { getInstallation } from "@/lib/installation/repository";
import { generateDuePaymentLinks } from "@/lib/payments/generate";
import { sendInstallmentReminderRequests } from "@/lib/line/installment-reminders";
import { appendAudit } from "@/lib/sheets/payments";

async function auditJob(action: string, status: string, metadata: object): Promise<void> {
  try {
    await appendAudit({ paymentId: "", clientId: "", action, previousStatus: "", newStatus: status,
      reason: "Independent installment reminder recovery job", source: "CRON_REMINDERS", metadata: JSON.stringify(metadata) });
  } catch {
    console.warn("LINE_REMINDER_JOB_AUDIT_UNAVAILABLE", { action, status });
  }
}

/** Recover only seven-day reminders; other reminder slots stay in the primary job. */
export async function GET(request: NextRequest): Promise<Response> {
  const secret = cronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if ((await getInstallation())?.setupStatus !== "COMPLETE") return Response.json({ error: "Setup incomplete" }, { status: 503 });
  let config;
  try { config = await runtimeConfig(); } catch { return Response.json({ error: "Setup incomplete" }, { status: 503 }); }
  if (!config.lineMessagingEnabled) return Response.json({ disabled: true, reminders: [] });
  await auditJob("LINE_REMINDER_JOB_STARTED", "STARTED", {});
  const failedStages: string[] = [];
  let created = 0;
  try {
    const generated = await generateDuePaymentLinks({ baseUrl: config.publicBaseUrl, remindersOnly: true });
    created = generated.created.length;
    if (generated.failed.length) failedStages.push("generate");
  } catch {
    failedStages.push("generate");
  }
  let reminders: string[] = [];
  try { reminders = await sendInstallmentReminderRequests({ baseUrl: config.publicBaseUrl, slots: ["T_MINUS_7_DAYS"] }); }
  catch { failedStages.push("reminders"); }
  await auditJob("LINE_REMINDER_JOB_COMPLETED", failedStages.length ? "ATTENTION" : "COMPLETED", { created, accepted: reminders.length, failedStages });
  return Response.json({ created, reminders, failed_stages: failedStages }, { status: failedStages.length ? 503 : 200 });
}
