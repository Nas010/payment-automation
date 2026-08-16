/** Derives the configured PromptPay display suffix without exposing the identifier. */
export function deriveRecipientProxySuffix(promptPayIdentifier: string | null | undefined): string | null {
  if (!promptPayIdentifier) return null;
  const digits = promptPayIdentifier.replace(/\D/gu, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}
