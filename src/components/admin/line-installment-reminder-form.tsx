"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { REMINDER_SLOTS, type LineInstallmentReminderConfig, type ResolvedLineInstallmentReminderConfig, type ReminderSlot } from "@/lib/line/message-profile";

type Result = { ok: true; slot: ReminderSlot; config: LineInstallmentReminderConfig; preview: string };
type Props = { resolved: ResolvedLineInstallmentReminderConfig; previewAction: (formData: FormData) => Promise<Result>; saveAction: (formData: FormData) => Promise<Result>; resetAction: () => Promise<Result> };
const labels: Record<ReminderSlot, string> = { T_MINUS_7_DAYS: "T−7 days", T_MINUS_3_DAYS: "T−3 days", T_MINUS_1_DAY: "T−1 day", DUE_DATE: "Due date", T_PLUS_1_DAY: "T+1 day" };

export function LineInstallmentReminderForm({ resolved, previewAction, saveAction, resetAction }: Props) {
  const [config, setConfig] = useState<LineInstallmentReminderConfig | null>(resolved.kind === "VALID" ? resolved.config : null);
  const [preview, setPreview] = useState("");
  const [pending, startTransition] = useTransition();
  if (!config) return <Card><CardHeader><CardTitle>Installment reminders</CardTitle></CardHeader><CardContent>Stored reminder setup is invalid.</CardContent></Card>;
  const send = (action: (data: FormData) => Promise<Result>, slot: ReminderSlot) => startTransition(() => { const data = new FormData(); data.set("slot", slot); data.set("config", JSON.stringify(config)); void action(data).then((result) => { setConfig(result.config); setPreview(result.preview); }); });
  return <Card><CardHeader><CardTitle>Installment reminders</CardTitle><CardDescription>Global templates for every later installment. Each message needs amount, due_date, and payment_url; every send includes the same payment QR.</CardDescription></CardHeader><CardContent className="space-y-4">{REMINDER_SLOTS.map((slot) => <div key={slot}><label className="mb-1 block text-sm font-medium">{labels[slot]} message</label><Textarea rows={5} value={config.profiles[slot].message} onChange={(event) => setConfig({ ...config, profiles: { ...config.profiles, [slot]: { ...config.profiles[slot], message: event.target.value } } })} /><Button className="mt-2" type="button" variant="outline" disabled={pending} onClick={() => send(previewAction, slot)}>Preview</Button></div>)}<div className="flex gap-2"><Button type="button" disabled={pending} onClick={() => send(saveAction, "DUE_DATE")}>Save reminder templates</Button><Button type="button" variant="ghost" disabled={pending} onClick={() => startTransition(() => { void resetAction().then((result) => setConfig(result.config)); })}>Restore defaults</Button></div>{preview ? <pre className="whitespace-pre-wrap rounded border p-3 text-sm">{preview}</pre> : null}</CardContent></Card>;
}
