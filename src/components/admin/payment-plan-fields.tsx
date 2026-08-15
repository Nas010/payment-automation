"use client";

import { useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Field as FormField, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type AdminPackage = { package_name: string; total_price_thb: string; payment_type: string; installment_count: string; interval_months: string };

export type PaymentPlanValues = {
  package_name: string;
  payment_type: "ONE_TIME" | "INSTALLMENTS";
  total_price_thb: number;
  installment_count: number;
  interval_months: number;
  first_due_date: string;
  notes: string;
};

export function PaymentPlanFields({ form, packages, idPrefix }: { form: UseFormReturn<PaymentPlanValues>; packages: AdminPackage[]; idPrefix: string }) {
  const selectedPackageName = form.watch("package_name");
  const paymentType = form.watch("payment_type");
  const paymentTypeLabel = paymentType === "ONE_TIME" ? "One-time payment" : "Installments";

  useEffect(() => {
    const item = packages.find((entry) => entry.package_name === selectedPackageName);
    if (!item) return;
    form.setValue("total_price_thb", Number(item.total_price_thb));
    form.setValue("payment_type", item.payment_type === "INSTALLMENTS" ? "INSTALLMENTS" : "ONE_TIME");
    form.setValue("installment_count", Number(item.installment_count));
    form.setValue("interval_months", Number(item.interval_months));
  }, [form, packages, selectedPackageName]);

  useEffect(() => {
    if (paymentType !== "ONE_TIME") return;
    form.setValue("installment_count", 1);
    form.setValue("interval_months", 0);
  }, [form, paymentType]);

  return <FieldGroup className="grid gap-4 sm:grid-cols-2">
    <FormField data-invalid={Boolean(form.formState.errors.package_name)}><FieldLabel htmlFor={`${idPrefix}_package_name`}>Package</FieldLabel><Select name="package_name" value={selectedPackageName} onValueChange={(value) => form.setValue("package_name", String(value), { shouldValidate: true })}><SelectTrigger id={`${idPrefix}_package_name`} aria-invalid={Boolean(form.formState.errors.package_name)} className="w-full"><SelectValue placeholder="Choose a package" /></SelectTrigger><SelectContent><SelectGroup>{packages.map((item) => <SelectItem key={item.package_name} value={item.package_name}>{item.package_name}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldError>{form.formState.errors.package_name?.message}</FieldError></FormField>
    <FormField><FieldLabel htmlFor={`${idPrefix}_payment_type`}>Payment type</FieldLabel><Select name="payment_type" value={paymentType} onValueChange={(value) => form.setValue("payment_type", value === "INSTALLMENTS" ? "INSTALLMENTS" : "ONE_TIME")}><SelectTrigger id={`${idPrefix}_payment_type`} className="w-full"><SelectValue>{paymentTypeLabel}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="ONE_TIME">One-time payment</SelectItem><SelectItem value="INSTALLMENTS">Installments</SelectItem></SelectGroup></SelectContent></Select></FormField>
    <FormField data-invalid={Boolean(form.formState.errors.total_price_thb)}><FieldLabel htmlFor={`${idPrefix}_total_price_thb`}>Total price (THB)</FieldLabel><Input id={`${idPrefix}_total_price_thb`} type="number" step="0.01" min="0.01" inputMode="decimal" {...form.register("total_price_thb")} aria-invalid={Boolean(form.formState.errors.total_price_thb)} /><FieldError>{form.formState.errors.total_price_thb?.message}</FieldError></FormField>
    <FormField data-invalid={Boolean(form.formState.errors.first_due_date)}><FieldLabel htmlFor={`${idPrefix}_first_due_date`}>First due date</FieldLabel><Input id={`${idPrefix}_first_due_date`} type="date" {...form.register("first_due_date")} aria-invalid={Boolean(form.formState.errors.first_due_date)} /><FieldError>{form.formState.errors.first_due_date?.message}</FieldError></FormField>
    <FormField data-disabled={paymentType === "ONE_TIME"}><FieldLabel htmlFor={`${idPrefix}_installment_count`}>Installments</FieldLabel><Input id={`${idPrefix}_installment_count`} type="number" min="1" readOnly={paymentType === "ONE_TIME"} {...form.register("installment_count")} /><FieldDescription>{paymentType === "ONE_TIME" ? "One-time plans use one installment." : "Number of scheduled payments."}</FieldDescription></FormField>
    <FormField data-disabled={paymentType === "ONE_TIME"}><FieldLabel htmlFor={`${idPrefix}_interval_months`}>Interval months</FieldLabel><Input id={`${idPrefix}_interval_months`} type="number" min="0" readOnly={paymentType === "ONE_TIME"} {...form.register("interval_months")} /><FieldDescription>{paymentType === "ONE_TIME" ? "No interval is needed." : "Time between installments."}</FieldDescription></FormField>
    <FormField className="sm:col-span-2"><FieldLabel htmlFor={`${idPrefix}_notes`}>Notes</FieldLabel><Textarea id={`${idPrefix}_notes`} {...form.register("notes")} placeholder="Optional coaching or payment notes." /></FormField>
  </FieldGroup>;
}
