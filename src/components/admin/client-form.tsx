"use client";

import { useEffect, useRef, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field as FormField, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";

const schema = z.object({
  client_name: z.string().trim().min(1, "Client name is required"),
  package_name: z.string().min(1, "Choose a package"),
  payment_type: z.enum(["ONE_TIME", "INSTALLMENTS"]),
  total_price_thb: z.coerce.number().positive("Price must be positive"),
  installment_count: z.coerce.number().int().min(1),
  interval_months: z.coerce.number().int().min(0),
  first_due_date: z.string().min(1, "First due date is required"),
  notes: z.string(),
});

type Values = z.infer<typeof schema>;
export type AdminPackage = { package_name: string; total_price_thb: string; payment_type: string; installment_count: string; interval_months: string };

export function ClientForm({ packages, action }: { packages: AdminPackage[]; action: (formData: FormData) => void | Promise<void> }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { client_name: "", package_name: packages[0]?.package_name ?? "", payment_type: (packages[0]?.payment_type === "INSTALLMENTS" ? "INSTALLMENTS" : "ONE_TIME"), total_price_thb: Number(packages[0]?.total_price_thb ?? 0), installment_count: Number(packages[0]?.installment_count ?? 1), interval_months: Number(packages[0]?.interval_months ?? 0), first_due_date: new Date().toISOString().slice(0, 10), notes: "" } });
  const selectedPackage = form.watch("package_name");
  const paymentType = form.watch("payment_type");
  const paymentTypeLabel = paymentType === "ONE_TIME" ? "One-time payment" : "Installments";
  useEffect(() => { const item = packages.find((entry) => entry.package_name === selectedPackage); if (!item) return; form.setValue("total_price_thb", Number(item.total_price_thb)); form.setValue("payment_type", item.payment_type === "INSTALLMENTS" ? "INSTALLMENTS" : "ONE_TIME"); form.setValue("installment_count", Number(item.installment_count)); form.setValue("interval_months", Number(item.interval_months)); }, [form, packages, selectedPackage]);
  useEffect(() => { if (paymentType === "ONE_TIME") { form.setValue("installment_count", 1); form.setValue("interval_months", 0); } }, [form, paymentType]);

  return <form ref={formRef} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]" onSubmit={form.handleSubmit(() => { const data = new FormData(formRef.current!); startTransition(() => { void action(data); }); })}>
    <Card>
      <CardContent>
        <FieldSet>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field label="Client name" error={form.formState.errors.client_name?.message}><Input id="client_name" {...form.register("client_name")} aria-invalid={Boolean(form.formState.errors.client_name)} autoComplete="name" /></Field>
          </FieldGroup>
        </FieldSet>
        <FieldSet className="mt-6">
          <FieldLegend>Payment plan</FieldLegend>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <FormField data-invalid={Boolean(form.formState.errors.package_name)}><FieldLabel htmlFor="package_name">Package</FieldLabel><Select name="package_name" value={selectedPackage} onValueChange={(value) => form.setValue("package_name", String(value), { shouldValidate: true })}><SelectTrigger id="package_name" aria-invalid={Boolean(form.formState.errors.package_name)} className="w-full"><SelectValue placeholder="Choose a package" /></SelectTrigger><SelectContent><SelectGroup>{packages.map((item) => <SelectItem key={item.package_name} value={item.package_name}>{item.package_name}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldError>{form.formState.errors.package_name?.message}</FieldError></FormField>
            <FormField><FieldLabel htmlFor="payment_type">Payment type</FieldLabel><Select name="payment_type" value={paymentType} onValueChange={(value) => form.setValue("payment_type", value === "INSTALLMENTS" ? "INSTALLMENTS" : "ONE_TIME")}><SelectTrigger id="payment_type" className="w-full"><SelectValue>{paymentTypeLabel}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="ONE_TIME">One-time payment</SelectItem><SelectItem value="INSTALLMENTS">Installments</SelectItem></SelectGroup></SelectContent></Select></FormField>
            <Field label="Total price (THB)" error={form.formState.errors.total_price_thb?.message}><Input id="total_price_thb" type="number" step="0.01" min="0.01" inputMode="decimal" {...form.register("total_price_thb")} aria-invalid={Boolean(form.formState.errors.total_price_thb)} /></Field>
            <Field label="First due date" error={form.formState.errors.first_due_date?.message}><Input id="first_due_date" type="date" {...form.register("first_due_date")} aria-invalid={Boolean(form.formState.errors.first_due_date)} /></Field>
            <FormField data-disabled={paymentType === "ONE_TIME"}><FieldLabel htmlFor="installment_count">Installments</FieldLabel><Input id="installment_count" type="number" min="1" readOnly={paymentType === "ONE_TIME"} {...form.register("installment_count")} /><FieldDescription>{paymentType === "ONE_TIME" ? "One-time plans use one installment." : "Number of scheduled payments."}</FieldDescription></FormField>
            <FormField data-disabled={paymentType === "ONE_TIME"}><FieldLabel htmlFor="interval_months">Interval months</FieldLabel><Input id="interval_months" type="number" min="0" readOnly={paymentType === "ONE_TIME"} {...form.register("interval_months")} /><FieldDescription>{paymentType === "ONE_TIME" ? "No interval is needed." : "Time between installments."}</FieldDescription></FormField>
            <Field label="Notes" className="sm:col-span-2"><Textarea id="notes" {...form.register("notes")} placeholder="Optional coaching or payment notes." /></Field>
          </FieldGroup>
        </FieldSet>
        <div className="mt-6 flex justify-end"><Button type="submit" size="lg" disabled={pending}>{pending ? "Creating…" : "Create client and schedule"}</Button></div>
      </CardContent>
    </Card>
    <Card size="sm" className="h-fit xl:sticky xl:top-6">
      <CardHeader><CardTitle>Plan summary</CardTitle><CardDescription>Review before creating schedule rows.</CardDescription></CardHeader>
      <CardContent><dl className="grid gap-4 text-sm"><Summary label="Payment type" value={paymentType === "ONE_TIME" ? "One payment" : installmentLabel(form.watch("installment_count"))} /><Summary label="First due" value={form.watch("first_due_date")} /><Summary label="Total" value={`฿${Number(form.watch("total_price_thb") || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`} /></dl></CardContent>
    </Card>
  </form>;
}

function Field({ label, error, children, className }: { label: string; error?: string; children: React.ReactNode; className?: string }) { const id = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_|_$/g, ""); return <FormField className={className} data-invalid={Boolean(error)}><FieldLabel htmlFor={id}>{label}</FieldLabel>{children}{error ? <FieldError>{error}</FieldError> : null}</FormField>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value || "—"}</dd></div>; }
function installmentLabel(count: number) { return `${count} installment${count === 1 ? "" : "s"}`; }
