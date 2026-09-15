"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/date";
import { formatThb, parseSatang } from "@/lib/money";
import { buildInstallmentPlan, parseInstallmentOverrides } from "@/lib/plans/schedule";

type InstallmentPreviewProps = {
  paymentType: "ONE_TIME" | "INSTALLMENTS";
  totalPriceThb: number;
  firstDueDate: string;
  installmentCount: number;
  intervalMonths: number;
};

export function InstallmentPreview({ paymentType, totalPriceThb, firstDueDate, installmentCount, intervalMonths }: InstallmentPreviewProps) {
  const [overrides, setOverrides] = useState<string[]>([]);
  const totalSatang = parseSatang(String(totalPriceThb));
  const normalizedCount = paymentType === "ONE_TIME" ? 1 : Number(installmentCount);
  const normalizedInterval = paymentType === "ONE_TIME" ? 0 : Number(intervalMonths);

  if (!totalSatang || totalSatang < 1) return null;

  try {
    const input = {
      totalSatang,
      firstDueDate,
      installmentCount: normalizedCount,
      intervalMonths: normalizedInterval,
    };
    let installments = buildInstallmentPlan(input);
    let error = "";
    try {
      installments = buildInstallmentPlan({ ...input, amountOverrides: parseInstallmentOverrides(JSON.stringify(overrides)) });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Invalid installment amounts";
    }

    return <section aria-labelledby="installment-preview-title" className="sm:col-span-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <h3 id="installment-preview-title" className="font-medium">Schedule preview</h3>
      {paymentType === "INSTALLMENTS" && <>
        <p className="mt-1 text-muted-foreground">Override any amount below. Blank amounts split the remaining balance automatically.</p>
        <input type="hidden" name="installment_overrides" value={JSON.stringify(overrides)} />
      </>}
      {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
      <ol className="mt-2 grid gap-1 text-muted-foreground">
        {installments.map((installment) => <li key={installment.installmentNumber}><span>{`${installment.installmentNumber}. ${formatDate(installment.dueDate)} — ${error ? "—" : formatThb(installment.amountSatang)}`}</span>
          {paymentType === "INSTALLMENTS" && <Input
            aria-label={`Installment ${installment.installmentNumber} override (THB)`}
            type="number" min="0.01" step="0.01" inputMode="decimal"
            placeholder={error ? "Automatic" : (installment.amountSatang / 100).toFixed(2)}
            value={overrides[installment.installmentNumber - 1] ?? ""}
            aria-invalid={Boolean(error)}
            ref={(element) => { element?.setCustomValidity(error); }}
            onChange={(event) => {
              const next = Array.from({ length: normalizedCount }, (_, index) => overrides[index] ?? "");
              next[installment.installmentNumber - 1] = event.target.value;
              setOverrides(next);
            }}
          />}</li>)}
      </ol>
    </section>;
  } catch {
    return null;
  }
}
