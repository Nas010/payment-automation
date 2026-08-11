import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get, update } = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock("../sheets/client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { values: { get, update } } } }),
}));

import { DEFAULT_LINE_DUE_TEMPLATE, renderLineDueTemplate, validateLineDueTemplate } from "./message-template";
import { getLineDueTemplate, upsertOperationalSetting } from "../sheets/settings";

const preview = {
  client_name: "Nisa",
  payment_label: "August coaching",
  amount: "฿1,500.00",
  due_date: "2026-08-15",
  payment_url: "https://pay.example/p/token_1",
};

beforeEach(() => {
  get.mockResolvedValue({ data: { values: [["key", "value"]] } });
  update.mockResolvedValue({});
});

afterEach(() => vi.clearAllMocks());

describe("LINE due-message templates", () => {
  it("renders documented default with concrete preview values", () => {
    expect(renderLineDueTemplate(DEFAULT_LINE_DUE_TEMPLATE, preview)).toBe(`Hi Nisa 👋

Your August coaching payment is due.

Amount: ฿1,500.00
Due date: 2026-08-15

Please scan the PromptPay QR below. After paying, send the bank payment slip back in this chat.

If you have trouble with the QR, use your payment page:
https://pay.example/p/token_1`);
  });

  it("renders optional client and payment labels in a custom template", () => {
    const template = "Hi {{client_name}} — {{payment_label}}: {{amount}} due {{due_date}}. Pay {{payment_url}}";

    expect(renderLineDueTemplate(template, preview)).toBe("Hi Nisa — August coaching: ฿1,500.00 due 2026-08-15. Pay https://pay.example/p/token_1");
  });

  it("rejects unsupported placeholders before a template is saved", () => {
    expect(() => validateLineDueTemplate("{{client_name}} {{amount}} {{due_date}} {{payment_url}} {{bank_name}}")).toThrow(/unsupported .*placeholder/i);
  });

  it("rejects malformed placeholders instead of treating them as literal text", () => {
    expect(() => validateLineDueTemplate("{{amount}} {{due_date}} {{payment_url}} {{client name}}")).toThrow(/unsupported .*placeholder/i);
  });

  it("rejects an empty placeholder", () => {
    expect(() => validateLineDueTemplate("{{amount}} {{due_date}} {{payment_url}} {{}}")).toThrow(/unsupported .*placeholder/i);
  });

  it("rejects a whitespace-only placeholder", () => {
    expect(() => validateLineDueTemplate("{{amount}} {{due_date}} {{payment_url}} {{   }}")).toThrow(/unsupported .*placeholder/i);
  });

  it("rejects templates missing a required payment placeholder", () => {
    expect(() => validateLineDueTemplate("{{client_name}} {{amount}} {{due_date}}")).toThrow(/requires placeholder/i);
  });

  it("rejects rendered LINE messages longer than 5000 characters", () => {
    expect(() => renderLineDueTemplate("{{amount}}{{due_date}}{{payment_url}}", {
      ...preview,
      amount: "x".repeat(4990),
    })).toThrow(/5000/);
  });

  it("returns a stored template and falls back to documented default", async () => {
    get.mockResolvedValueOnce({ data: { values: [["key", "value"], ["line_due_message_template", "{{amount}} {{due_date}} {{payment_url}}"]] } });
    await expect(getLineDueTemplate()).resolves.toBe("{{amount}} {{due_date}} {{payment_url}}");

    await expect(getLineDueTemplate()).resolves.toBe(DEFAULT_LINE_DUE_TEMPLATE);
  });

  it("validates a raw template before it is stored", async () => {
    await expect(upsertOperationalSetting("line_due_message_template", "{{amount}} {{due_date}}")).rejects.toThrow(/requires placeholder/i);
    expect(update).not.toHaveBeenCalled();
  });
});
