import { normalizeLineLinkCode } from "./link-code";

export function renderLineLinkInstruction({ clientName, code }: { clientName: string; code: string }): string {
  const normalizedCode = normalizeLineLinkCode(code);
  if (!normalizedCode) throw new Error("LINE link code is malformed");
  return `Hi ${clientName}, reply with this exact message to link your LINE account:\nLINK ${normalizedCode}`;
}
