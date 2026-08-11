export const DEFAULT_LINE_DUE_TEMPLATE = `Hi {{client_name}} 👋

Your {{payment_label}} payment is due.

Amount: {{amount}}
Due date: {{due_date}}

Please scan the PromptPay QR below. After paying, send the bank payment slip back in this chat.

If you have trouble with the QR, use your payment page:
{{payment_url}}`;

const allowedPlaceholders = ["client_name", "payment_label", "amount", "due_date", "payment_url"] as const;
const requiredPlaceholders = ["amount", "due_date", "payment_url"] as const;

export type LineDueTemplateValues = Record<(typeof allowedPlaceholders)[number], string>;

function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(/{{([^{}]*)}}/g)].map((match) => match[1].trim());
}

/** Validates workbook-authored message templates before they are persisted. */
export function validateLineDueTemplate(template: string): void {
  if (template.length < 1 || template.length > 5000) throw new Error("LINE due template must contain 1-5000 characters");
  const placeholders = templatePlaceholders(template);
  const unsupported = placeholders.find((placeholder) => !allowedPlaceholders.includes(placeholder as (typeof allowedPlaceholders)[number]));
  if (unsupported !== undefined) throw new Error(`Unsupported LINE due template placeholder: ${unsupported}`);
  const missing = requiredPlaceholders.find((placeholder) => !placeholders.includes(placeholder));
  if (missing) throw new Error(`LINE due template requires placeholder: ${missing}`);
}

/** Substitutes preview or delivery values after validating both template and LINE message length. */
export function renderLineDueTemplate(template: string, values: LineDueTemplateValues): string {
  validateLineDueTemplate(template);
  const rendered = template.replace(/{{([^{}]*)}}/g, (_match, placeholder: string) => values[placeholder.trim() as keyof LineDueTemplateValues]);
  if (rendered.length < 1 || rendered.length > 5000) throw new Error("Rendered LINE due message must contain 1-5000 characters");
  return rendered;
}
