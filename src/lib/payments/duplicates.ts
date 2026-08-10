export interface TransactionAllocation {
  payment_id: string;
  transaction_ref: string;
  originating_bank: string;
}

export function detectTransactionDuplicate(history: TransactionAllocation[], paymentId: string, bank: string | null, reference: string | null): boolean {
  if (!bank || !reference) return false;
  return history.some((payment) => payment.payment_id !== paymentId && payment.originating_bank === bank && payment.transaction_ref === reference);
}
