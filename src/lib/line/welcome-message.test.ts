import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";
import { createLineConnectionTokenFields } from "./connection-token";
import { renderClientLineWelcomeMessage } from "./welcome-message";

const encryptionKey = Buffer.alloc(32, 4).toString("base64");
const now = "2026-08-10T12:00:00.000Z";
const token = "A".repeat(43);

function client(): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: "", line_display_name: "", package_name: "PT", payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10", default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: now, updated_at: now,
    line_link_code: "", line_link_code_expires_at: "", line_link_status: "LINK_ACTIVE", line_linked_at: "", line_link_message: "", line_link_error: "",
    ...createLineConnectionTokenFields({ clientId: "client_1", now, tokenGenerator: () => token }),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("client LINE welcome rendering", () => {
  it("renders current global template on demand using recovered token", () => {
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
    const target = client();
    const input = { client: target, businessName: "Coach Bee", liffId: "1234567890-AbCdEf", now };

    expect(renderClientLineWelcomeMessage({ ...input, template: "First {{client_name}} at {{business_name}}: {{line_connect_url}}" }))
      .toBe(`First Nisa at Coach Bee: https://liff.line.me/1234567890-AbCdEf?token=${token}`);
    expect(renderClientLineWelcomeMessage({ ...input, template: "Updated: {{line_connect_url}}" }))
      .toBe(`Updated: https://liff.line.me/1234567890-AbCdEf?token=${token}`);
  });

  it("does not render an expired, consumed, or legacy code as a connection URL", () => {
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
    const target = client();
    const input = { client: target, template: "{{line_connect_url}}", businessName: "Coach Bee", liffId: "1234567890-AbCdEf" };

    expect(renderClientLineWelcomeMessage({ ...input, now: "2026-08-17T12:00:00.000Z" })).toBeNull();
    expect(renderClientLineWelcomeMessage({ ...input, now, client: { ...target, line_link_token_encrypted: "", line_link_status: "LINKED" } })).toBeNull();
    expect(renderClientLineWelcomeMessage({ ...input, now, client: { ...target, line_link_status: "CODE_ACTIVE", line_link_code: "ABCDEF0123" } })).toBeNull();
  });
});
