"use client";

import React, { cloneElement, useEffect, useState, useTransition, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminPackage } from "@/components/admin/payment-plan-fields";
import { REMINDER_SLOTS, type ReminderSlot } from "@/lib/line/message-profile";
import type { LineMessageTestAdminView } from "@/lib/line/message-test-profile";

type Result =
  | { ok: true; profile: LineMessageTestAdminView; preview?: string; outcome?: "ACCEPTED" | "FAILED" | "REVIEW"; requestCode?: string; connectUrl?: string }
  | { ok: false; message: string };

type Props = {
  initialProfile: LineMessageTestAdminView;
  packages: AdminPackage[];
  initialConnectUrl: string;
  linkingEnabled: boolean;
  messagingEnabled: boolean;
  saveAction: (formData: FormData) => Promise<Result>;
  renewAction: () => Promise<Result>;
  disconnectAction: () => Promise<Result>;
  previewAction: (formData: FormData) => Promise<Result>;
  sendAction: (formData: FormData) => Promise<Result>;
};

const reminderLabels: Record<ReminderSlot, string> = {
  T_MINUS_7_DAYS: "T−7 days",
  T_MINUS_3_DAYS: "T−3 days",
  T_MINUS_1_DAY: "T−1 day",
  DUE_DATE: "Due date",
  T_PLUS_1_DAY: "T+1 day",
};

export function LineMessageTestForm({
  initialProfile,
  packages,
  initialConnectUrl,
  linkingEnabled,
  messagingEnabled,
  saveAction,
  renewAction,
  disconnectAction,
  previewAction,
  sendAction,
}: Props) {
  const [profile, setProfile] = useState(initialProfile);
  const [connectUrl, setConnectUrl] = useState(initialConnectUrl);
  const [stage, setStage] = useState<"INITIAL" | "LATER">("INITIAL");
  const [installmentNumber, setInstallmentNumber] = useState(2);
  const [reminderSlot, setReminderSlot] = useState<ReminderSlot>("T_MINUS_7_DAYS");
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => setProfile(initialProfile), [initialProfile]);
  useEffect(() => setConnectUrl(initialConnectUrl), [initialConnectUrl]);

  const installmentPayment = profile.paymentType === "INSTALLMENTS";
  const effectiveStage = installmentPayment ? stage : "INITIAL";
  const installmentOptions = Array.from({ length: Math.max(0, profile.installmentCount - 1) }, (_, index) => index + 2);

  function selectPackage(packageName: string) {
    const selected = packages.find((item) => item.package_name === packageName);
    if (!selected) return;
    const paymentType = selected.payment_type === "INSTALLMENTS" ? "INSTALLMENTS" : "ONE_TIME";
    setProfile({
      ...profile,
      packageName: selected.package_name,
      totalPriceThb: selected.total_price_thb,
      paymentType,
      installmentCount: paymentType === "INSTALLMENTS" ? Math.max(2, Number(selected.installment_count) || 2) : 1,
      intervalMonths: paymentType === "INSTALLMENTS" ? Math.max(1, Number(selected.interval_months) || 1) : 0,
    });
    if (paymentType === "ONE_TIME") setStage("INITIAL");
  }

  function formData(): FormData {
    const data = new FormData();
    data.set("client_name", profile.clientName);
    data.set("package_name", profile.packageName);
    data.set("total_price_thb", profile.totalPriceThb);
    data.set("payment_type", profile.paymentType);
    data.set("installment_count", String(profile.installmentCount));
    data.set("interval_months", String(profile.intervalMonths));
    data.set("first_due_date", profile.firstDueDate);
    data.set("scenario_payment_type", profile.paymentType);
    data.set("scenario_stage", effectiveStage);
    if (effectiveStage === "LATER") {
      data.set("installment_number", String(installmentNumber));
      data.set("reminder_slot", reminderSlot);
    }
    return data;
  }

  function applyResult(result: Result, successMessage: string) {
    if (!result.ok) {
      setStatus(result.message);
      return;
    }
    setProfile(result.profile);
    if (result.connectUrl) setConnectUrl(result.connectUrl);
    if (result.preview) setPreview(result.preview);
    setStatus(result.outcome
      ? `${result.outcome === "ACCEPTED" ? "Accepted" : result.outcome === "REVIEW" ? "Review required" : "Failed"}${result.requestCode ? ` (${result.requestCode})` : ""}`
      : successMessage);
  }

  function runFormAction(action: (data: FormData) => Promise<Result>, successMessage: string) {
    startTransition(() => { void action(formData()).then((result) => applyResult(result, successMessage)); });
  }

  function runConnectionAction(action: () => Promise<Result>, successMessage: string) {
    startTransition(() => { void action().then((result) => applyResult(result, successMessage)); });
  }

  return <Card>
    <CardHeader>
      <CardTitle>LINE message testing</CardTitle>
      <CardDescription>Send current payment and reminder templates to one dedicated test account. Test QR codes cannot accept payment.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Client name"><Input value={profile.clientName} onChange={(event) => setProfile({ ...profile, clientName: event.target.value })} /></Field>
        <Field label="Package">
          <select className="h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm" value={profile.packageName} onChange={(event) => selectPackage(event.target.value)}>
            {packages.map((item) => <option key={item.package_name} value={item.package_name}>{item.package_name}</option>)}
          </select>
        </Field>
        <Field label="Total price (THB)"><Input inputMode="decimal" value={profile.totalPriceThb} onChange={(event) => setProfile({ ...profile, totalPriceThb: event.target.value })} /></Field>
        <Field label="First due date"><Input type="date" value={profile.firstDueDate} onChange={(event) => setProfile({ ...profile, firstDueDate: event.target.value })} /></Field>
        <Field label="Payment type">
          <select className="h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm" value={profile.paymentType} onChange={(event) => {
            const paymentType = event.target.value as "ONE_TIME" | "INSTALLMENTS";
            setProfile({ ...profile, paymentType, installmentCount: paymentType === "ONE_TIME" ? 1 : Math.max(2, profile.installmentCount), intervalMonths: paymentType === "ONE_TIME" ? 0 : Math.max(1, profile.intervalMonths) });
            if (paymentType === "ONE_TIME") setStage("INITIAL");
          }}><option value="ONE_TIME">One-time payment</option><option value="INSTALLMENTS">Installments</option></select>
        </Field>
        {installmentPayment ? <>
          <Field label="Installment count"><Input type="number" min={2} value={profile.installmentCount} onChange={(event) => setProfile({ ...profile, installmentCount: Math.max(2, Number(event.target.value) || 2) })} /></Field>
          <Field label="Interval (months)"><Input type="number" min={1} value={profile.intervalMonths} onChange={(event) => setProfile({ ...profile, intervalMonths: Math.max(1, Number(event.target.value) || 1) })} /></Field>
          <Field label="Payment stage"><select className="h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm" value={stage} onChange={(event) => setStage(event.target.value as "INITIAL" | "LATER")}><option value="INITIAL">Initial payment</option><option value="LATER">Later payment</option></select></Field>
          {stage === "LATER" ? <>
            <Field label="Installment number"><select className="h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm" value={installmentNumber} onChange={(event) => setInstallmentNumber(Number(event.target.value))}>{installmentOptions.map((number) => <option key={number} value={number}>{number}</option>)}</select></Field>
            <Field label="Reminder timing"><select className="h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm" value={reminderSlot} onChange={(event) => setReminderSlot(event.target.value as ReminderSlot)}>{REMINDER_SLOTS.map((slot) => <option key={slot} value={slot}>{reminderLabels[slot]}</option>)}</select></Field>
          </> : null}
        </> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={pending} onClick={() => runFormAction(saveAction, "Test client saved")}>Save test client</Button>
        {profile.lineLinkStatus === "LINKED" ? <>
          <span className="text-sm text-muted-foreground">Connected as {profile.lineDisplayName || "test account"}</span>
          <Button type="button" variant="outline" disabled={pending} onClick={() => runConnectionAction(renewAction, "Connection renewed")}>Reconnect</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => runConnectionAction(disconnectAction, "Disconnected")}>Disconnect</Button>
        </> : connectUrl ? <a className="text-sm font-medium text-primary underline" href={connectUrl} target="_blank" rel="noreferrer">Connect test LINE account</a> : <Button type="button" variant="outline" disabled={pending || !linkingEnabled} onClick={() => runConnectionAction(renewAction, "Connection ready")}>Create connection</Button>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => runFormAction(previewAction, "Preview ready")}>Preview message</Button>
        <Button type="button" disabled={pending || !messagingEnabled || profile.lineLinkStatus !== "LINKED"} onClick={() => runFormAction(sendAction, "Test sent")}>Send test message</Button>
      </div>
      {preview ? <pre className="whitespace-pre-wrap rounded-lg border p-3 text-sm">{preview}</pre> : null}
      <p role="status" aria-live="polite" className="text-sm">{status}</p>
    </CardContent>
  </Card>;
}

function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const id = `line-test-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{cloneElement(children, { id })}</div>;
}
