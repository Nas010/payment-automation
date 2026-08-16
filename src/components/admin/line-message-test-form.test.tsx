/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultLineMessageTestProfile, toLineMessageTestAdminView } from "@/lib/line/message-test-profile";
import { LineMessageTestForm } from "./line-message-test-form";

const packages = [
  { package_name: "Starter package", total_price_thb: "1500", payment_type: "ONE_TIME", installment_count: "1", interval_months: "0" },
  { package_name: "Three-month package", total_price_thb: "4500", payment_type: "INSTALLMENTS", installment_count: "3", interval_months: "1" },
];

const initial = toLineMessageTestAdminView({
  ...createDefaultLineMessageTestProfile("2026-08-15"),
  clientName: "Coach sample client",
  packageName: "Three-month package",
  paymentType: "INSTALLMENTS",
  installmentCount: 3,
  intervalMonths: 1,
});

function props(overrides: Record<string, unknown> = {}) {
  return {
    initialProfile: initial,
    packages,
    initialConnectUrl: "https://liff.line.me/1234567890-Test?token=safe",
    linkingEnabled: true,
    messagingEnabled: true,
    saveAction: vi.fn(async () => ({ ok: true as const, profile: initial })),
    renewAction: vi.fn(async () => ({ ok: true as const, profile: initial, connectUrl: "https://liff.line.me/1234567890-Test?token=new" })),
    disconnectAction: vi.fn(async () => ({ ok: true as const, profile: { ...initial, lineLinkStatus: "" as const, lineDisplayName: "" } })),
    previewAction: vi.fn(async () => ({ ok: true as const, profile: initial, preview: "Rendered test message" })),
    sendAction: vi.fn(async () => ({ ok: true as const, profile: initial, outcome: "ACCEPTED" as const, requestCode: "request_1" })),
    ...overrides,
  };
}

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("LineMessageTestForm", () => {
  it("starts with persisted client details and uses a package chooser", () => {
    render(<LineMessageTestForm {...props()} />);
    expect((screen.getByLabelText("Client name") as HTMLInputElement).value).toBe("Coach sample client");
    expect((screen.getByLabelText("Package") as HTMLSelectElement).value).toBe("Three-month package");
    expect(screen.queryByLabelText(/recipient/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Connect test LINE account" }).getAttribute("href")).toContain("liff.line.me");
  });

  it("applies selected package defaults while keeping the test client editable", () => {
    render(<LineMessageTestForm {...props()} />);

    fireEvent.change(screen.getByLabelText("Package"), { target: { value: "Starter package" } });

    expect((screen.getByLabelText("Total price (THB)") as HTMLInputElement).value).toBe("1500");
    expect((screen.getByLabelText("Payment type") as HTMLSelectElement).value).toBe("ONE_TIME");
    expect(screen.queryByLabelText("Installment count")).toBeNull();
    expect((screen.getByLabelText("First due date") as HTMLInputElement).value).toBe("2026-08-15");
  });

  it("uses installment settings only for installment test clients", () => {
    render(<LineMessageTestForm {...props()} />);
    expect(screen.getByLabelText("Installment count")).not.toBeNull();
    expect(screen.getByLabelText("Interval (months)")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("Payment type"), { target: { value: "ONE_TIME" } });
    expect(screen.queryByLabelText("Installment number")).toBeNull();
    expect(screen.queryByLabelText("Installment count")).toBeNull();
    expect(screen.queryByLabelText("Interval (months)")).toBeNull();
  });

  it("keeps preview and delivery actions out of recipient setup", () => {
    render(<LineMessageTestForm {...props()} />);
    expect(screen.queryByRole("button", { name: "Preview message" })).toBeNull();
    expect(screen.queryByRole("button", { name: /send test message/i })).toBeNull();
  });
});
