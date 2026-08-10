export function needsManualConfirmationAudit(payment: { status: string; manual_confirmed_at: string }): boolean {
  return payment.status === "MANUAL_CONFIRMED" && !payment.manual_confirmed_at;
}
