/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("forces one-time to initial and shows later controls plus all five slots only for installments", () => {
    render(<LineMessageTestForm {...props()} />);
    fireEvent.change(screen.getByLabelText("Payment stage"), { target: { value: "LATER" } });
    expect(screen.getByLabelText("Installment number")).not.toBeNull();
    expect(screen.getByLabelText("Reminder timing").querySelectorAll("option")).toHaveLength(5);

    fireEvent.change(screen.getByLabelText("Payment type"), { target: { value: "ONE_TIME" } });
    expect(screen.queryByLabelText("Payment stage")).toBeNull();
    expect(screen.queryByLabelText("Installment number")).toBeNull();
    expect(screen.queryByLabelText("Reminder timing")).toBeNull();
  });

  it("previews without sending and disables send until linked", async () => {
    const actions = props();
    const { rerender } = render(<LineMessageTestForm {...actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview message" }));
    await screen.findByText("Rendered test message");
    expect(actions.previewAction).toHaveBeenCalledOnce();
    expect(actions.sendAction).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Send test message" }) as HTMLButtonElement).disabled).toBe(true);

    const linkedProfile = { ...initial, lineLinkStatus: "LINKED" as const, lineDisplayName: "Test Account" };
    rerender(<LineMessageTestForm {...props({ initialProfile: linkedProfile })} />);
    expect((screen.getByRole("button", { name: "Send test message" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows accepted delivery in the live status region", async () => {
    const linkedProfile = { ...initial, lineLinkStatus: "LINKED" as const, lineDisplayName: "Test Account" };
    render(<LineMessageTestForm {...props({ initialProfile: linkedProfile })} />);
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Accepted"));
  });
});
