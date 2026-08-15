import { formatThb, parseSatang } from "@/lib/money";
import { planTotalSatangForSchedule } from "@/lib/plans/schedule";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";
import { formatCardinalWord, formatOrdinalNumber, formatOrdinalWord } from "./installment-language";
import { LineDueTemplateError, type LineDueSystemValues, type LinePaymentType } from "./message-profile";

export function resolveLineDueMessageValues({
  payment,
  client,
  schedules,
}: {
  payment: PaymentRecord;
  client: ClientRecord;
  schedules: readonly ScheduleRecord[];
}): { paymentType: LinePaymentType; values: LineDueSystemValues } {
  const snapshotBacked = [
    payment.package_name,
    payment.payment_type,
    payment.installment_number,
    payment.installment_count,
    payment.total_price_thb,
  ].some(Boolean);
  const legacySchedule = snapshotBacked ? undefined : schedules.find((item) => item.payment_id === payment.payment_id);
  const paymentType = snapshotBacked ? payment.payment_type : legacySchedule?.payment_type;
  if (paymentType !== "ONE_TIME" && paymentType !== "INSTALLMENTS") {
    throw new LineDueTemplateError("TEMPLATE_DATA_MISSING", "Missing payment type");
  }

  const packageName = snapshotBacked ? payment.package_name : legacySchedule?.package_name;
  const installmentNumber = snapshotBacked ? payment.installment_number : legacySchedule?.installment_number;
  const installmentCount = snapshotBacked ? payment.installment_count : legacySchedule?.installment_count;
  let totalSatang = parseSatang(payment.total_price_thb);
  if (!snapshotBacked && totalSatang === null && legacySchedule) {
    try {
      totalSatang = planTotalSatangForSchedule(legacySchedule, schedules);
    } catch {
      totalSatang = null;
    }
  }

  const amountSatang = parseSatang(payment.amount_thb);
  if (amountSatang === null) {
    throw new LineDueTemplateError("TEMPLATE_DATA_MISSING", "Missing payment amount");
  }

  const values: LineDueSystemValues = {
    client_name: client.client_name,
    package_name: packageName || undefined,
    payment_type: paymentType === "ONE_TIME" ? "One-time payment" : "Installments",
    amount: formatThb(amountSatang),
    total_amount: totalSatang === null ? undefined : formatThb(totalSatang),
    due_date: payment.due_date,
    due_month_name: new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "Asia/Bangkok" }).format(new Date(`${payment.due_date}T12:00:00+07:00`)),
    payment_url: payment.payment_url,
  };

  if (paymentType === "INSTALLMENTS" && installmentNumber && installmentCount) {
    const number = Number(installmentNumber);
    const count = Number(installmentCount);
    if (Number.isSafeInteger(number) && Number.isSafeInteger(count) && number >= 1 && count >= 1 && number <= count) {
      Object.assign(values, {
        installment_number: String(number),
        installment_ordinal: formatOrdinalNumber(number),
        installment_number_word: formatCardinalWord(number),
        installment_ordinal_word: formatOrdinalWord(number),
        installment_count: String(count),
        installment_count_word: formatCardinalWord(count),
      });
    }
  }

  return { paymentType, values };
}
