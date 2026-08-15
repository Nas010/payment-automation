/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClientForm } from "./client-form";

beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClientForm", () => {
  it("does not allow manual LINE identity entry when creating a client", () => {
    render(createElement(ClientForm, {
      action: vi.fn(),
      packages: [{ package_name: "Starter", total_price_thb: "1500", payment_type: "ONE_TIME", installment_count: "1", interval_months: "0" }],
    }));

    expect(screen.queryByLabelText("LINE user ID")).toBeNull();
    expect(screen.queryByLabelText("LINE display name")).toBeNull();
  });

  it("submits one-time plan defaults when installment controls are locked", async () => {
    const action = vi.fn();
    const { container } = render(createElement(ClientForm, {
      action,
      packages: [{ package_name: "Starter", total_price_thb: "1500", payment_type: "ONE_TIME", installment_count: "1", interval_months: "0" }],
    }));

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.change(container.querySelector("#client_name")!, { target: { value: "Nisa" } });
    fireEvent.submit(form!);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const submitted = action.mock.calls[0][0] as FormData;
    expect(submitted.get("installment_count")).toBe("1");
    expect(submitted.get("interval_months")).toBe("0");
  });

  it("renders the selected payment type in natural language without client-form chrome", () => {
    render(createElement(ClientForm, {
      action: vi.fn(),
      packages: [{ package_name: "Starter", total_price_thb: "1500", payment_type: "ONE_TIME", installment_count: "1", interval_months: "0" }],
    }));

    expect(screen.getByRole("combobox", { name: "Payment type" }).textContent).toContain("One-time payment");
    expect(screen.queryByText("Client plan")).toBeNull();
    expect(screen.queryByText("Identity, package, and billing terms. Package selection fills the default plan.")).toBeNull();
    expect(screen.queryByText("Client details")).toBeNull();
  });

  it("previews every exact installment date and amount before creating a client", async () => {
    render(createElement(ClientForm, {
      action: vi.fn(),
      packages: [{ package_name: "Starter", total_price_thb: "100", payment_type: "INSTALLMENTS", installment_count: "3", interval_months: "1" }],
    }));

    fireEvent.change(screen.getByLabelText("First due date"), { target: { value: "2026-01-31" } });

    await waitFor(() => expect(screen.getByRole("region", { name: "Schedule preview" }).textContent).toContain("1. 31 Jan 2026 — ฿33.33"));
    const preview = screen.getByRole("region", { name: "Schedule preview" });
    expect(preview.textContent).toContain("2. 28 Feb 2026 — ฿33.33");
    expect(preview.textContent).toContain("3. 31 Mar 2026 — ฿33.34");
  });
});
