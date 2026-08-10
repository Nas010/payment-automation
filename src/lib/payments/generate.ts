import { createPublicToken } from "./token";
import { appendPayment, listPayments, type PaymentRecord } from "@/lib/sheets/payments";
import { listClients } from "@/lib/sheets/clients";

export async function generateMonthlyPayments(period: string, baseUrl: string): Promise<PaymentRecord[]> {
  const [clients, existing] = await Promise.all([listClients(), listPayments()]);
  const created: PaymentRecord[] = [];
  for (const client of clients) {
    if (client.active !== "TRUE" || client.billing_frequency !== "MONTHLY" || existing.some((payment) => payment.client_id === client.client_id && payment.period === period)) continue;
    const token = createPublicToken();
    const paymentId = `pay_${crypto.randomUUID().replaceAll("-", "")}`;
    const dueDate = client.next_due_date || `${period}-01`;
    const amount = Number(client.default_amount_thb);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const paymentUrl = `${baseUrl.replace(/\/$/, "")}/p/${token}`;
    const payment = { payment_id: paymentId, client_id: client.client_id, client_name: client.client_name, period, amount_thb: String(amount), due_date: dueDate, public_token: token, payment_url: paymentUrl, status: "PENDING", created_at: new Date().toISOString(), submitted_at: "", recorded_at: "", manual_confirmed_at: "", transaction_ref: "", originating_bank: "", slip_hash: "", qr_valid: "", ocr_amount: "", amount_match: "", ocr_receiver: "", receiver_match: "", ocr_transaction_date: "", date_match: "", check_score: "", review_reason: "", slip_url: "", admin_notes: "", line_message: `Hi ${client.line_display_name || client.client_name}, your ${period} coaching payment of ฿${amount.toLocaleString("en-US")} is due. You can pay here: ${paymentUrl}`, updated_at: new Date().toISOString() };
    await appendPayment(payment);
    created.push(payment);
  }
  return created;
}
