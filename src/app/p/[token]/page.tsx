import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { SlipUpload } from "@/components/slip-upload";
import { serverConfig } from "@/lib/config";
import { formatThb, parseSatang } from "@/lib/money";
import { buildPaymentPromptPayPayload } from "@/lib/payments/promptpay";
import { getPaymentByToken } from "@/lib/sheets/payments";

export const dynamic = "force-dynamic";

export default async function PaymentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let payment;
  try { payment = await getPaymentByToken(token); } catch { return <main className="payment"><h1 className="brand">Coaching Payments</h1><p className="status">Payment links are being securely configured. Please contact your coach.</p></main>; }
  if (!payment) notFound();
  const config = serverConfig();
  // Sheets returns a formatted currency cell (for example "฿1.00") after a
  // payment row has been updated, so do not rely on Number(...) here.
  const amountSatang = parseSatang(payment.amount_thb);
  if (amountSatang === null || amountSatang <= 0) return <main className="payment"><h1 className="brand">Coaching Payments</h1><p className="status">This payment amount is unavailable. Please contact your coach.</p></main>;
  const payload = buildPaymentPromptPayPayload(payment, config);
  const qr = await QRCode.toDataURL(payload, { width: 720, margin: 1, errorCorrectionLevel: "M" });
  const recorded = payment.status === "AUTO_RECORDED" || payment.status === "MANUAL_CONFIRMED";
  const awaitingReview = payment.status === "REVIEW" || payment.status === "FLAGGED";
  const reviewMessage = payment.status === "FLAGGED" ? "Your payment slip needs a quick review. Please contact your coach." : "Your payment slip has been received and is awaiting review.";
  return <main className="payment"><h1 className="brand">{config.businessDisplayName}</h1><p className="greeting">Hi {payment.client_name.split(" ")[0] || "there"}</p><section className="invoice"><p className="period">{payment.period} Coaching Payment</p><p className="amount">{formatThb(amountSatang)}</p></section><p className="recipient"><strong>Recipient:</strong> {config.recipientNameEn}</p><div className="qr-frame"><img src={qr} alt="PromptPay QR code for this exact payment amount" /></div><p className="instruction">Scan or save this QR and pay using your banking app.</p><a className="download" href={qr} download={`promptpay-${payment.payment_id}.png`}>Download or save QR</a>{recorded ? <p className="already">Payment already recorded.</p> : awaitingReview ? <p className="status">{reviewMessage}</p> : <SlipUpload token={token} />}</main>;
}
