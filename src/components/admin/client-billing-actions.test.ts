/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ClientBillingActions } from "./client-billing-actions";

const packages = [{
  package_name: "Extended coaching",
  total_price_thb: "1200",
  payment_type: "INSTALLMENTS",
  installment_count: "2",
  interval_months: "1",
}];

beforeEach(() => {
  vi.stubGlobal("React", React);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClientBillingActions", () => {
  it("shows package-extension and custom-payment workflows together", () => {
    render(createElement(ClientBillingActions, { packages, assignPackageAction: vi.fn(), createManualPaymentAction: vi.fn() }));

    expect(screen.getByRole("heading", { name: "Assign package" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add manual payment" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Package" })).toHaveTextContent("Extended coaching");
    expect(screen.getByLabelText("Package first due date")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount (THB)")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Frequency" })).toHaveTextContent("One-time payment");
    expect(screen.getByLabelText("Payment count")).toBeInTheDocument();
    expect(screen.getByLabelText("Interval months")).toBeInTheDocument();
  });

  it("submits selected package and first due date", async () => {
    const assignPackageAction = vi.fn();
    render(createElement(ClientBillingActions, { packages, assignPackageAction, createManualPaymentAction: vi.fn() }));
    fireEvent.change(screen.getByLabelText("Package first due date"), { target: { value: "2026-08-31" } });

    fireEvent.click(screen.getByRole("button", { name: "Assign package" }));

    await waitFor(() => expect(assignPackageAction).toHaveBeenCalledTimes(1));
    const submitted = assignPackageAction.mock.calls[0][0] as FormData;
    expect(submitted.get("package_name")).toBe("Extended coaching");
    expect(submitted.get("first_due_date")).toBe("2026-08-31");
  });

  it("submits safe one-time defaults for a manual payment", async () => {
    const createManualPaymentAction = vi.fn();
    render(createElement(ClientBillingActions, { packages, assignPackageAction: vi.fn(), createManualPaymentAction }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Assessment" } });
    fireEvent.change(screen.getByLabelText("Amount (THB)"), { target: { value: "750" } });
    fireEvent.change(screen.getByLabelText("Manual payment first due date"), { target: { value: "2026-08-20" } });

    fireEvent.click(screen.getByRole("button", { name: "Add manual payment" }));

    await waitFor(() => expect(createManualPaymentAction).toHaveBeenCalledTimes(1));
    const submitted = createManualPaymentAction.mock.calls[0][0] as FormData;
    expect(submitted.get("frequency")).toBe("ONE_TIME");
    expect(submitted.get("payment_count")).toBe("1");
    expect(submitted.get("interval_months")).toBe("0");
  });
});
