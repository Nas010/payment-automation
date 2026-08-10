import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { SlipUpload } from "@/components/slip-upload";
import { serverConfig } from "@/lib/config";
import { formatThb } from "@/lib/money";
import { getPaymentByToken } from "@/lib/sheets/payments";
import { buildPromptPayPayload } from "@/lib/promptpay/generate";

export const dynamic = "force-dynamic";

export default async function PaymentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let payment;
  try { payment = await getPaymentByToken(token); } catch { return <main className="payment"><h1 className="brand">Coaching Payments</h1><p className="status">Payment links are being securely configured. Please contact your coach.</p></main>; }
  if (!payment) notFound();
  const config = serverConfig();
  const amountSatang = Math.round(Number(payment.amount_thb) * 100);
  const payload = buildPromptPayPayload(config.promptPayIdentifier, config.promptPayType, amountSatang);
  const qr = await QRCode.toDataURL(payload, { width: 720, margin: 1, errorCorrectionLevel: "M" });
  const recorded = payment.status === "AUTO_RECORDED" || payment.status === "MANUAL_CONFIRMED";
  return <main className="payment"><h1 className="brand">{config.businessDisplayName}</h1><p className="greeting">Hi {payment.client_name.split(" ")[0] || "there"}</p><section className="invoice"><p className="period">{payment.period} Coaching Payment</p><p className="amount">{formatThb(amountSatang)}</p></section><p className="recipient"><strong>Recipient:</strong> {config.recipientNameEn}</p><div className="qr-frame"><img src={qr} alt="PromptPay QR code for this exact payment amount" /></div><p className="instruction">Scan or save this QR and pay using your banking app.</p><a className="download" href={qr} download={`promptpay-${payment.payment_id}.png`}>Download or save QR</a>{recorded ? <p className="already">Payment already recorded.</p> : <SlipUpload token={token} />}</main>;
}
