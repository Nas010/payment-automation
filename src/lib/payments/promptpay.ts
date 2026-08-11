import { parseSatang } from "@/lib/money";
import { buildPromptPayPayload, type PromptPayType } from "@/lib/promptpay/generate";

type PaymentAmount = { amount_thb: string };
type PromptPayConfiguration = { promptPayIdentifier: string; promptPayType: PromptPayType };

export class InvalidPaymentAmountError extends Error {
  constructor() {
    super("Payment amount is invalid");
    this.name = "InvalidPaymentAmountError";
  }
}

/** Builds one payable PromptPay payload from canonical payment-sheet data. */
export function buildPaymentPromptPayPayload(payment: PaymentAmount, config: PromptPayConfiguration): string {
  const amountSatang = parseSatang(payment.amount_thb);
  if (amountSatang === null || amountSatang <= 0) throw new InvalidPaymentAmountError();
  return buildPromptPayPayload(config.promptPayIdentifier, config.promptPayType, amountSatang);
}
