import { formatDate } from "@/lib/date";
import { formatThb, parseSatang } from "@/lib/money";
import { buildInstallmentPlan } from "@/lib/plans/schedule";

type InstallmentPreviewProps = {
  paymentType: "ONE_TIME" | "INSTALLMENTS";
  totalPriceThb: number;
  firstDueDate: string;
  installmentCount: number;
  intervalMonths: number;
};

export function InstallmentPreview({ paymentType, totalPriceThb, firstDueDate, installmentCount, intervalMonths }: InstallmentPreviewProps) {
  const totalSatang = parseSatang(String(totalPriceThb));
  const normalizedCount = paymentType === "ONE_TIME" ? 1 : Number(installmentCount);
  const normalizedInterval = paymentType === "ONE_TIME" ? 0 : Number(intervalMonths);

  if (!totalSatang || totalSatang < 1) return null;

  try {
    const installments = buildInstallmentPlan({
      totalSatang,
      firstDueDate,
      installmentCount: normalizedCount,
      intervalMonths: normalizedInterval,
    });

    return <section aria-labelledby="installment-preview-title" className="sm:col-span-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <h3 id="installment-preview-title" className="font-medium">Schedule preview</h3>
      <ol className="mt-2 grid gap-1 text-muted-foreground">
        {installments.map((installment) => <li key={installment.installmentNumber}>{`${installment.installmentNumber}. ${formatDate(installment.dueDate)} — ${formatThb(installment.amountSatang)}`}</li>)}
      </ol>
    </section>;
  } catch {
    return null;
  }
}
