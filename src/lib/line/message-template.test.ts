import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get, update } = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock("../sheets/client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { values: { get, update } } } }),
}));

import {
  DEFAULT_LINE_DUE_TEMPLATE,
  DEFAULT_LINE_WELCOME_TEMPLATE,
  renderLineDueTemplate,
  renderLineWelcomeTemplate,
  validateLineDueTemplate,
  validateLineWelcomeTemplate,
} from "./message-template";
import { getLineDueTemplate, getLineWelcomeTemplate, upsertOperationalSetting } from "../sheets/settings";

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

const welcomePreview = {
  client_name: "Nisa",
  business_name: "Coach Bee",
  line_connect_url: "https://liff.line.me/1234567890-AbCdEf?token=sample-token",
};

describe("LINE welcome-message templates", () => {
  it("renders documented default with every approved placeholder", () => {
    const rendered = renderLineWelcomeTemplate(DEFAULT_LINE_WELCOME_TEMPLATE, welcomePreview);

    expect(rendered).toContain("Nisa");
    expect(rendered).toContain("Coach Bee");
    expect(rendered).toContain("https://liff.line.me/1234567890-AbCdEf?token=sample-token");
    expect(rendered).not.toContain("{{");
  });

  it("renders all approved placeholders in a custom template", () => {
    expect(renderLineWelcomeTemplate(
      "Hi {{client_name}} — welcome to {{business_name}}. Connect: {{line_connect_url}}",
      welcomePreview,
    )).toBe("Hi Nisa — welcome to Coach Bee. Connect: https://liff.line.me/1234567890-AbCdEf?token=sample-token");
  });

  it("requires connection URL and rejects unknown placeholders", () => {
    expect(() => validateLineWelcomeTemplate("Hi {{client_name}} from {{business_name}}"))
      .toThrow(/requires placeholder: line_connect_url/i);
    expect(() => validateLineWelcomeTemplate("{{line_connect_url}} {{payment_url}}"))
      .toThrow(/unsupported .*placeholder: payment_url/i);
  });

  it("rejects empty and overlength rendered welcome messages", () => {
    expect(() => validateLineWelcomeTemplate(""))
      .toThrow(/1-5000/);
    expect(() => renderLineWelcomeTemplate("{{line_connect_url}}", {
      ...welcomePreview,
      line_connect_url: `https://example.test/${"x".repeat(5000)}`,
    })).toThrow(/5000/);
  });

  it("returns stored welcome template and falls back to documented default", async () => {
    get.mockResolvedValueOnce({ data: { values: [["key", "value"], ["line_welcome_message_template", "Welcome: {{line_connect_url}}"]] } });
    await expect(getLineWelcomeTemplate()).resolves.toBe("Welcome: {{line_connect_url}}");

    await expect(getLineWelcomeTemplate()).resolves.toBe(DEFAULT_LINE_WELCOME_TEMPLATE);
  });

  it("validates raw welcome template before storage", async () => {
    await expect(upsertOperationalSetting("line_welcome_message_template", "Hi {{client_name}}"))
      .rejects.toThrow(/requires placeholder/i);
    expect(update).not.toHaveBeenCalled();
  });
});
