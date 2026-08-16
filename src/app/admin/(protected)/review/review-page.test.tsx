import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentRecord } from "@/lib/sheets/payments";

const mocks = vi.hoisted(() => ({ listPayments: vi.fn() }));

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children) }));
vi.mock("@/lib/sheets/payments", () => ({ listPayments: mocks.listPayments }));

import ReviewPage from "./page";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    rowNumber: 2, payment_id: "pay_1", client_id: "client_1", client_name: "Nisa", period: "2026-08", amount_thb: "1500", due_date: "2026-08-15", payment_url: "https://payments.example/p/token", status: "REVIEW", created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-10T08:30:00.000Z",
    ...overrides,
  } as PaymentRecord;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.listPayments.mockResolvedValue([payment()]);
});

describe("ReviewPage", () => {
  it("shows one clear review count without duplicate review copy", async () => {
    const html = renderToStaticMarkup(await ReviewPage());

    expect(html).toContain(">Needs review<");
    expect(html).not.toContain(">Review<");
    expect(html).not.toContain("Payments requiring a coach's independent verification.");
  });
});
