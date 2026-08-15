import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLineConnectionTokenFields } from "@/lib/line/connection-token";
import type { ClientRecord } from "@/lib/sheets/clients";

const mocks = vi.hoisted(() => ({
  listClients: vi.fn(),
  listSchedules: vi.fn(),
  getLineWelcomeTemplate: vi.fn(),
  runtimeConfig: vi.fn(),
  disconnectLineAction: vi.fn(),
  renewLineConnectionAction: vi.fn(),
}));

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children) }));
vi.mock("next/image", () => ({ default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => React.createElement("img", props) }));
vi.mock("@/lib/sheets/clients", () => ({ listClients: mocks.listClients }));
vi.mock("@/lib/sheets/schedules", () => ({ listSchedules: mocks.listSchedules }));
vi.mock("@/lib/sheets/settings", () => ({ getLineWelcomeTemplate: mocks.getLineWelcomeTemplate }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("../actions", () => ({
  disconnectLineAction: mocks.disconnectLineAction,
  renewLineConnectionAction: mocks.renewLineConnectionAction,
}));

import ClientsPage from "./page";

const now = "2026-08-10T12:00:00.000Z";
const token = "B".repeat(43);

function client(): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: "", line_display_name: "", line_picture_url: "", package_name: "PT", payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10", default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: now, updated_at: now,
    line_link_code: "", line_link_code_expires_at: "", line_link_status: "LINK_ACTIVE", line_linked_at: "", line_link_message: "", line_link_error: "",
    ...createLineConnectionTokenFields({ clientId: "client_1", now, tokenGenerator: () => token }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
  mocks.listClients.mockResolvedValue([client()]);
  mocks.listSchedules.mockResolvedValue([]);
  mocks.getLineWelcomeTemplate.mockResolvedValue("Welcome {{client_name}}: {{line_connect_url}}");
  mocks.runtimeConfig.mockResolvedValue({ businessDisplayName: "Coach Bee", lineLiffId: "1234567890-AbCdEf" });
});

describe("ClientsPage LINE connection", () => {
  it("provides the current welcome message to awaiting clients without exposing a legacy code", async () => {
    const html = renderToStaticMarkup(await ClientsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Awaiting connection");
    expect(html).toContain("Copy welcome message");
    expect(html).not.toContain("LINK ABCDEF0123");
    expect(html).not.toContain("one-time code");
  });

  it("shows the linked client's LINE picture in the directory", async () => {
    mocks.listClients.mockResolvedValue([{ ...client(), line_user_id: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", line_display_name: "Nisa LINE", line_picture_url: "https://profile.line-scdn.net/avatar/path", line_link_status: "LINKED" }]);

    const html = renderToStaticMarkup(await ClientsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("LINE profile picture for Nisa");
    expect(html).toContain("https://profile.line-scdn.net/avatar/path");
  });
});
