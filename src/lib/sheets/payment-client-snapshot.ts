import { getGoogleSheets } from "./client";
import type { ClientRecord } from "./clients";
import { ensureClientSchema, ensurePaymentSchema } from "./migration";
import type { PaymentRecord } from "./payments";
import { CLIENT_HEADERS, PAYMENT_HEADERS, rowToRecord } from "./records";

export type PaymentClientSnapshot = {
  payments: PaymentRecord[];
  clients: ClientRecord[];
};

/** Reads the two mutable admin ledgers in one Sheets quota request. */
export async function readPaymentClientSnapshot(): Promise<PaymentClientSnapshot> {
  await Promise.all([ensurePaymentSchema(), ensureClientSchema()]);
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ["Payments!A:AR", "Clients!A:W"],
  });
  const [paymentRange, clientRange] = response.data.valueRanges ?? [];
  const payments = (paymentRange?.values ?? [])
    .slice(1)
    .map((row, index) => ({ ...rowToRecord(PAYMENT_HEADERS, row), rowNumber: index + 2 }) as PaymentRecord)
    .filter((row) => row.payment_id);
  const clients = (clientRange?.values ?? [])
    .slice(1)
    .map((row, index) => ({ ...rowToRecord(CLIENT_HEADERS, row), rowNumber: index + 2 }) as ClientRecord)
    .filter((row) => row.client_id);

  return { payments, clients };
}
