import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";
import { createLineConnectionTokenFields } from "@/lib/line/connection-token";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(),
  listClients: vi.fn(),
  listSchedules: vi.fn(),
  listPayments: vi.fn(),
  listAuditRecords: vi.fn(),
  listPackages: vi.fn(),
  getLineWelcomeTemplate: vi.fn(),
  runtimeConfig: vi.fn(),
  assignPackageAction: vi.fn(),
  createManualPaymentAction: vi.fn(),
  changePackageAssignmentAction: vi.fn(),
  pausePackageAssignmentAction: vi.fn(),
  resumePackageAssignmentAction: vi.fn(),
  endPackageAssignmentAction: vi.fn(),
  deletePackageAssignmentAction: vi.fn(),
  disconnectLineAction: vi.fn(),
  renewLineConnectionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children) }));
vi.mock("next/image", () => ({ default: (imageProps: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => { const { unoptimized, ...props } = imageProps; void unoptimized; return React.createElement("img", props); } }));
vi.mock("@/lib/sheets/clients", () => ({ listClients: mocks.listClients }));
vi.mock("@/lib/sheets/schedules", () => ({ listSchedules: mocks.listSchedules }));
vi.mock("@/lib/sheets/payments", () => ({ listPayments: mocks.listPayments }));
vi.mock("@/lib/sheets/audit", () => ({ listAuditRecords: mocks.listAuditRecords }));
vi.mock("@/lib/sheets/settings", () => ({ listPackages: mocks.listPackages, getLineWelcomeTemplate: mocks.getLineWelcomeTemplate }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("../../actions", () => ({
  assignPackageAction: mocks.assignPackageAction,
  createManualPaymentAction: mocks.createManualPaymentAction,
  changePackageAssignmentAction: mocks.changePackageAssignmentAction,
  pausePackageAssignmentAction: mocks.pausePackageAssignmentAction,
  resumePackageAssignmentAction: mocks.resumePackageAssignmentAction,
  endPackageAssignmentAction: mocks.endPackageAssignmentAction,
  deletePackageAssignmentAction: mocks.deletePackageAssignmentAction,
  disconnectLineAction: mocks.disconnectLineAction,
  renewLineConnectionAction: mocks.renewLineConnectionAction,
}));

import ClientDetailPage from "./page";

const now = "2026-08-10T12:00:00.000Z";
const token = "A".repeat(43);

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
  mocks.listPayments.mockResolvedValue([]);
  mocks.listAuditRecords.mockResolvedValue([]);
  mocks.listPackages.mockResolvedValue([]);
  mocks.getLineWelcomeTemplate.mockResolvedValue("Welcome {{client_name}} to {{business_name}}: {{line_connect_url}}");
  mocks.runtimeConfig.mockResolvedValue({ businessDisplayName: "Coach Bee", lineLiffId: "1234567890-AbCdEf" });
});

describe("ClientDetailPage LINE connection", () => {
  it("renders current global welcome message for immediate copying after client creation", async () => {
    const html = renderToStaticMarkup(await ClientDetailPage({ params: Promise.resolve({ clientId: "client_1" }) }));

    expect(html).toContain("Awaiting connection");
    expect(html).toContain("Copy welcome message");
    expect(html).toContain(`Welcome Nisa to Coach Bee: https://liff.line.me/1234567890-AbCdEf?token=${token}`);
    expect(html).not.toContain("LINK ABCDEF0123");
    expect(html).not.toContain("one-time code");
  });

  it("shows the linked client's LINE picture in the page header", async () => {
    mocks.listClients.mockResolvedValue([{ ...client(), line_user_id: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", line_display_name: "Nisa LINE", line_picture_url: "https://profile.line-scdn.net/avatar/path", line_link_status: "LINKED" }]);

    const html = renderToStaticMarkup(await ClientDetailPage({ params: Promise.resolve({ clientId: "client_1" }) }));

    expect(html).toContain("LINE profile picture for Nisa");
    expect(html).toContain("https://profile.line-scdn.net/avatar/path");
  });
});

describe("ClientDetailPage package assignments", () => {
  it("shows package lifecycle controls before New billing without turning manual charges into package cards", async () => {
    mocks.listSchedules.mockResolvedValue([
      { rowNumber: 2, schedule_id: "paid", client_id: "client_1", client_name: "Nisa", line_user_id: "", line_display_name: "", package_name: "Coaching", payment_type: "INSTALLMENTS", installment_number: "1", installment_count: "2", amount_thb: "500", due_date: "2026-08-01", status: "PAID", generated_at: "", payment_id: "", payment_url: "", notes: "", created_at: now, updated_at: now, assignment_id: "assignment_1", assignment_kind: "PACKAGE" },
      { rowNumber: 3, schedule_id: "remaining", client_id: "client_1", client_name: "Nisa", line_user_id: "", line_display_name: "", package_name: "Coaching", payment_type: "INSTALLMENTS", installment_number: "2", installment_count: "2", amount_thb: "500", due_date: "2026-09-01", status: "SCHEDULED", generated_at: "", payment_id: "", payment_url: "", notes: "", created_at: now, updated_at: now, assignment_id: "assignment_1", assignment_kind: "PACKAGE" },
      { rowNumber: 4, schedule_id: "manual", client_id: "client_1", client_name: "Nisa", line_user_id: "", line_display_name: "", package_name: "Extra session", payment_type: "ONE_TIME", installment_number: "1", installment_count: "1", amount_thb: "200", due_date: "2026-09-02", status: "SCHEDULED", generated_at: "", payment_id: "", payment_url: "", notes: "", created_at: now, updated_at: now, assignment_id: "manual_1", assignment_kind: "MANUAL" },
    ]);
    mocks.listPackages.mockResolvedValue([
      { rowNumber: 2, package_name: "Premium coaching", total_price_thb: "1500", payment_type: "INSTALLMENTS", installment_count: "3", interval_months: "1", active: "TRUE" },
      { rowNumber: 3, package_name: "Coaching", total_price_thb: "1000", payment_type: "INSTALLMENTS", installment_count: "2", interval_months: "1", active: "TRUE" },
    ]);

    const html = renderToStaticMarkup(await ClientDetailPage({ params: Promise.resolve({ clientId: "client_1" }) }));

    expect(html).toContain("Package assignments");
    expect(html).toContain("Coaching");
    expect(html).toContain("฿500.00");
    expect(html).toContain("Pause");
    expect(html).toContain("End");
    expect(html.indexOf("Package assignments")).toBeLessThan(html.indexOf("New billing"));
    expect(html).not.toContain('>Extra session</h3>');
  });
});
