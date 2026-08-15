import { getGoogleSheets } from "./client";
import type { ClientRecord } from "./clients";
import { ensureClientSchema, ensurePaymentSchema } from "./migration";
import type { PaymentRecord } from "./payments";
import type { ScheduleRecord } from "./schedules";
import { CLIENT_HEADERS, PAYMENT_HEADERS, rowToRecord, SCHEDULE_HEADERS } from "./records";

export type PaymentClientSnapshot = {
  payments: PaymentRecord[];
  clients: ClientRecord[];
  schedules: ScheduleRecord[];
};

/** Reads mutable payment, client, and schedule ledgers in one Sheets quota request. */
export async function readPaymentClientSnapshot(): Promise<PaymentClientSnapshot> {
  await Promise.all([ensurePaymentSchema(), ensureClientSchema()]);
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ["Payments!A:AW", "Clients!A:W", "Installment Schedule!A:R"],
  });
  const [paymentRange, clientRange, scheduleRange] = response.data.valueRanges ?? [];
  const payments = (paymentRange?.values ?? [])
    .slice(1)
    .map((row, index) => ({ ...rowToRecord(PAYMENT_HEADERS, row), rowNumber: index + 2 }) as PaymentRecord)
    .filter((row) => row.payment_id);
  const clients = (clientRange?.values ?? [])
    .slice(1)
    .map((row, index) => ({ ...rowToRecord(CLIENT_HEADERS, row), rowNumber: index + 2 }) as ClientRecord)
    .filter((row) => row.client_id);
  const schedules = (scheduleRange?.values ?? [])
    .slice(1)
    .map((row, index) => ({ ...rowToRecord(SCHEDULE_HEADERS, row), rowNumber: index + 2 }) as ScheduleRecord)
    .filter((row) => row.schedule_id);

  return { payments, clients, schedules };
}
