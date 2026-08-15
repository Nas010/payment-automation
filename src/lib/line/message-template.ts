export const DEFAULT_LINE_DUE_TEMPLATE = `Hi {{client_name}} 👋

Your {{payment_label}} payment is due.

Amount: {{amount}}
Due date: {{due_date}}

Please scan the PromptPay QR below. After paying, send the bank payment slip back in this chat.

If you have trouble with the QR, use your payment page:
{{payment_url}}`;

export const DEFAULT_LINE_WELCOME_TEMPLATE = `Hi {{client_name}} 👋

Welcome to {{business_name}}.

Tap once to connect your LINE account:
{{line_connect_url}}

This secure link expires in 7 days and can only be used once.`;

const duePlaceholders = ["client_name", "payment_label", "amount", "due_date", "payment_url"] as const;
const dueRequiredPlaceholders = ["amount", "due_date", "payment_url"] as const;
const welcomePlaceholders = ["client_name", "business_name", "line_connect_url"] as const;
const welcomeRequiredPlaceholders = ["line_connect_url"] as const;

export type LineDueTemplateValues = Record<(typeof duePlaceholders)[number], string>;
export type LineWelcomeTemplateValues = Record<(typeof welcomePlaceholders)[number], string>;

function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(/{{([^{}]*)}}/g)].map((match) => match[1].trim());
}

/** Validates workbook-authored message templates before they are persisted. */
export function validateLineDueTemplate(template: string): void {
  if (template.length < 1 || template.length > 5000) throw new Error("LINE due template must contain 1-5000 characters");
  const placeholders = templatePlaceholders(template);
  const unsupported = placeholders.find((placeholder) => !duePlaceholders.includes(placeholder as (typeof duePlaceholders)[number]));
  if (unsupported !== undefined) throw new Error(`Unsupported LINE due template placeholder: ${unsupported}`);
  const missing = dueRequiredPlaceholders.find((placeholder) => !placeholders.includes(placeholder));
  if (missing) throw new Error(`LINE due template requires placeholder: ${missing}`);
}

/** Substitutes preview or delivery values after validating both template and LINE message length. */
export function renderLineDueTemplate(template: string, values: LineDueTemplateValues): string {
  validateLineDueTemplate(template);
  const rendered = template.replace(/{{([^{}]*)}}/g, (_match, placeholder: string) => values[placeholder.trim() as keyof LineDueTemplateValues]);
  if (rendered.length < 1 || rendered.length > 5000) throw new Error("Rendered LINE due message must contain 1-5000 characters");
  return rendered;
}

/** Validates global welcome templates before they are persisted. */
export function validateLineWelcomeTemplate(template: string): void {
  if (template.length < 1 || template.length > 5000) throw new Error("LINE welcome template must contain 1-5000 characters");
  const placeholders = templatePlaceholders(template);
  const unsupported = placeholders.find((placeholder) => !welcomePlaceholders.includes(placeholder as (typeof welcomePlaceholders)[number]));
  if (unsupported !== undefined) throw new Error(`Unsupported LINE welcome template placeholder: ${unsupported}`);
  const missing = welcomeRequiredPlaceholders.find((placeholder) => !placeholders.includes(placeholder));
  if (missing) throw new Error(`LINE welcome template requires placeholder: ${missing}`);
}

/** Renders one client's copyable welcome message from current global settings. */
export function renderLineWelcomeTemplate(template: string, values: LineWelcomeTemplateValues): string {
  validateLineWelcomeTemplate(template);
  const rendered = template.replace(/{{([^{}]*)}}/g, (_match, placeholder: string) => values[placeholder.trim() as keyof LineWelcomeTemplateValues]);
  if (rendered.length < 1 || rendered.length > 5000) throw new Error("Rendered LINE welcome message must contain 1-5000 characters");
  return rendered;
}
