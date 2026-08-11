"use client";

import { useEffect, useRef, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { bangkokDateKey } from "@/lib/date";
import { formatThb, parseSatang } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type BillingPackage = {
  package_name: string;
  total_price_thb: string;
  payment_type: string;
  installment_count: string;
  interval_months: string;
};

type BillingAction = (formData: FormData) => void | Promise<void>;

const packageSchema = z.object({
  package_name: z.string().min(1, "Choose a package"),
  first_due_date: z.string().min(1, "First due date is required"),
  notes: z.string(),
});

const manualSchema = z.object({
  description: z.string().trim().min(1, "Description is required"),
  amount_thb: z.coerce.number().positive("Amount must be positive"),
  frequency: z.enum(["ONE_TIME", "RECURRING"]),
  payment_count: z.coerce.number().int().min(1),
  interval_months: z.coerce.number().int().min(0),
  first_due_date: z.string().min(1, "First due date is required"),
  notes: z.string(),
}).superRefine((value, context) => {
  if (value.frequency !== "RECURRING") return;
  if (value.payment_count < 2) context.addIssue({ code: "custom", path: ["payment_count"], message: "Recurring payments need at least two payments" });
  if (value.interval_months < 1) context.addIssue({ code: "custom", path: ["interval_months"], message: "Recurring payments need at least a one-month interval" });
});

type PackageValues = z.infer<typeof packageSchema>;
type ManualValues = z.infer<typeof manualSchema>;

export function ClientBillingActions({ packages, assignPackageAction, createManualPaymentAction }: { packages: BillingPackage[]; assignPackageAction: BillingAction; createManualPaymentAction: BillingAction }) {
  return <section aria-labelledby="new-billing-title" className="flex flex-col gap-3">
    <div className="flex flex-col gap-1">
      <h2 id="new-billing-title" className="text-lg font-semibold">New billing</h2>
      <p className="text-sm text-muted-foreground">Extend this client&apos;s program or schedule a charge outside their package.</p>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <AssignPackageForm packages={packages} action={assignPackageAction} />
      <ManualPaymentForm action={createManualPaymentAction} />
    </div>
  </section>;
}

function AssignPackageForm({ packages, action }: { packages: BillingPackage[]; action: BillingAction }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<PackageValues>({
    resolver: zodResolver(packageSchema),
    defaultValues: { package_name: packages[0]?.package_name ?? "", first_due_date: bangkokDateKey(), notes: "" },
  });
  const selectedPackageName = form.watch("package_name");
  const selectedPackage = packages.find((item) => item.package_name === selectedPackageName);

  return <Card>
    <CardHeader><CardTitle><h3>Assign package</h3></CardTitle><CardDescription>Add another program using an active package&apos;s saved terms.</CardDescription></CardHeader>
    <CardContent><form ref={formRef} onSubmit={form.handleSubmit(() => { const data = new FormData(formRef.current!); startTransition(() => { void action(data); }); })}>
      <FieldSet><FieldGroup>
        <Field data-invalid={Boolean(form.formState.errors.package_name)}><FieldLabel htmlFor="package_name">Package</FieldLabel><Select name="package_name" value={selectedPackageName} onValueChange={(value) => form.setValue("package_name", String(value), { shouldValidate: true })}><SelectTrigger id="package_name" className="w-full" aria-invalid={Boolean(form.formState.errors.package_name)}><SelectValue placeholder="Choose a package" /></SelectTrigger><SelectContent><SelectGroup>{packages.map((item) => <SelectItem key={item.package_name} value={item.package_name}>{item.package_name}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldError>{form.formState.errors.package_name?.message}</FieldError></Field>
        <Field data-invalid={Boolean(form.formState.errors.first_due_date)}><FieldLabel htmlFor="package_first_due_date">Package first due date</FieldLabel><Input id="package_first_due_date" type="date" {...form.register("first_due_date")} aria-invalid={Boolean(form.formState.errors.first_due_date)} /><FieldError>{form.formState.errors.first_due_date?.message}</FieldError></Field>
        <Field><FieldLabel htmlFor="package_notes">Notes</FieldLabel><Textarea id="package_notes" {...form.register("notes")} placeholder="Optional notes for this extension." /></Field>
        {selectedPackage ? <FieldDescription>{packageSummary(selectedPackage)}</FieldDescription> : <FieldDescription>No active package is available. Add or activate one in Packages first.</FieldDescription>}
        <Button type="submit" disabled={pending || !selectedPackage}>{pending ? "Assigning…" : "Assign package"}</Button>
      </FieldGroup></FieldSet>
    </form></CardContent>
  </Card>;
}

function ManualPaymentForm({ action }: { action: BillingAction }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<ManualValues>({
    resolver: zodResolver(manualSchema),
    defaultValues: { description: "", amount_thb: 0, frequency: "ONE_TIME", payment_count: 1, interval_months: 0, first_due_date: bangkokDateKey(), notes: "" },
  });
  const frequency = form.watch("frequency");
  useEffect(() => {
    if (frequency !== "ONE_TIME") return;
    form.setValue("payment_count", 1);
    form.setValue("interval_months", 0);
  }, [form, frequency]);

  return <Card>
    <CardHeader><CardTitle><h3>Add manual payment</h3></CardTitle><CardDescription>Schedule a one-time or recurring charge outside active packages.</CardDescription></CardHeader>
    <CardContent><form ref={formRef} onSubmit={form.handleSubmit(() => { const data = new FormData(formRef.current!); startTransition(() => { void action(data); }); })}>
      <FieldSet><FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2" data-invalid={Boolean(form.formState.errors.description)}><FieldLabel htmlFor="manual_description">Description</FieldLabel><Input id="manual_description" {...form.register("description")} aria-invalid={Boolean(form.formState.errors.description)} placeholder="Extra session, assessment, add-on…" /><FieldError>{form.formState.errors.description?.message}</FieldError></Field>
        <Field data-invalid={Boolean(form.formState.errors.amount_thb)}><FieldLabel htmlFor="manual_amount_thb">Amount (THB)</FieldLabel><Input id="manual_amount_thb" type="number" min="0.01" step="0.01" inputMode="decimal" {...form.register("amount_thb")} aria-invalid={Boolean(form.formState.errors.amount_thb)} /><FieldError>{form.formState.errors.amount_thb?.message}</FieldError></Field>
        <Field data-invalid={Boolean(form.formState.errors.first_due_date)}><FieldLabel htmlFor="manual_first_due_date">Manual payment first due date</FieldLabel><Input id="manual_first_due_date" type="date" {...form.register("first_due_date")} aria-invalid={Boolean(form.formState.errors.first_due_date)} /><FieldError>{form.formState.errors.first_due_date?.message}</FieldError></Field>
        <Field><FieldLabel htmlFor="manual_frequency">Frequency</FieldLabel><Select name="frequency" value={frequency} onValueChange={(value) => form.setValue("frequency", value === "RECURRING" ? "RECURRING" : "ONE_TIME", { shouldValidate: true })}><SelectTrigger id="manual_frequency" className="w-full"><SelectValue>{frequency === "RECURRING" ? "Recurring" : "One-time payment"}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="ONE_TIME">One-time payment</SelectItem><SelectItem value="RECURRING">Recurring</SelectItem></SelectGroup></SelectContent></Select></Field>
        <Field data-disabled={frequency === "ONE_TIME"} data-invalid={Boolean(form.formState.errors.payment_count)}><FieldLabel htmlFor="manual_payment_count">Payment count</FieldLabel><Input id="manual_payment_count" type="number" min={frequency === "ONE_TIME" ? 1 : 2} readOnly={frequency === "ONE_TIME"} {...form.register("payment_count")} aria-invalid={Boolean(form.formState.errors.payment_count)} /><FieldError>{form.formState.errors.payment_count?.message}</FieldError></Field>
        <Field data-disabled={frequency === "ONE_TIME"} data-invalid={Boolean(form.formState.errors.interval_months)}><FieldLabel htmlFor="manual_interval_months">Interval months</FieldLabel><Input id="manual_interval_months" type="number" min={frequency === "ONE_TIME" ? 0 : 1} readOnly={frequency === "ONE_TIME"} {...form.register("interval_months")} aria-invalid={Boolean(form.formState.errors.interval_months)} /><FieldDescription>{frequency === "ONE_TIME" ? "No recurrence interval is needed." : "Whole months between payments."}</FieldDescription><FieldError>{form.formState.errors.interval_months?.message}</FieldError></Field>
        <Field className="sm:col-span-2"><FieldLabel htmlFor="manual_notes">Notes</FieldLabel><Textarea id="manual_notes" {...form.register("notes")} placeholder="Optional notes for this charge." /></Field>
        <Button className="sm:col-span-2" type="submit" disabled={pending}>{pending ? "Scheduling…" : "Add manual payment"}</Button>
      </FieldGroup></FieldSet>
    </form></CardContent>
  </Card>;
}

function packageSummary(item: BillingPackage): string {
  const total = formatThb(parseSatang(item.total_price_thb) ?? 0);
  if (item.payment_type !== "INSTALLMENTS") return `${total} · one payment`;
  const count = Number(item.installment_count);
  const interval = Number(item.interval_months);
  return `${total} · ${count} payments · every ${interval} month${interval === 1 ? "" : "s"}`;
}
