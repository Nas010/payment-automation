"use client";

import { useRef, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { bangkokDateKey, formatDate } from "@/lib/date";
import { PaymentPlanFields, type AdminPackage, type PaymentPlanValues } from "@/components/admin/payment-plan-fields";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field as FormField, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";

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
export type { AdminPackage } from "@/components/admin/payment-plan-fields";

export function ClientForm({ packages, action }: { packages: AdminPackage[]; action: (formData: FormData) => void | Promise<void> }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { client_name: "", package_name: packages[0]?.package_name ?? "", payment_type: (packages[0]?.payment_type === "INSTALLMENTS" ? "INSTALLMENTS" : "ONE_TIME"), total_price_thb: Number(packages[0]?.total_price_thb ?? 0), installment_count: Number(packages[0]?.installment_count ?? 1), interval_months: Number(packages[0]?.interval_months ?? 0), first_due_date: bangkokDateKey(), notes: "" } });
  const paymentType = form.watch("payment_type");

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
          <PaymentPlanFields form={form as unknown as UseFormReturn<PaymentPlanValues>} packages={packages} idPrefix="client" />
        </FieldSet>
        <div className="mt-6 flex justify-end"><Button type="submit" size="lg" disabled={pending}>{pending ? "Creating…" : "Create client and schedule"}</Button></div>
      </CardContent>
    </Card>
    <Card size="sm" className="h-fit xl:sticky xl:top-6">
      <CardHeader><CardTitle>Plan summary</CardTitle><CardDescription>Review before creating schedule rows.</CardDescription></CardHeader>
      <CardContent><dl className="grid gap-4 text-sm"><Summary label="Payment type" value={paymentType === "ONE_TIME" ? "One payment" : installmentLabel(form.watch("installment_count"))} /><Summary label="First due" value={formatDate(form.watch("first_due_date"))} /><Summary label="Total" value={`฿${Number(form.watch("total_price_thb") || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`} /></dl></CardContent>
    </Card>
  </form>;
}

function Field({ label, error, children, className }: { label: string; error?: string; children: React.ReactNode; className?: string }) { const id = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_|_$/g, ""); return <FormField className={className} data-invalid={Boolean(error)}><FieldLabel htmlFor={id}>{label}</FieldLabel>{children}{error ? <FieldError>{error}</FieldError> : null}</FormField>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value || "—"}</dd></div>; }
function installmentLabel(count: number) { return `${count} installment${count === 1 ? "" : "s"}`; }
