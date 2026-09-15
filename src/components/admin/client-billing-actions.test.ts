/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getByLabelText("First due date")).toBeInTheDocument();
    const manualForm = screen.getByRole("button", { name: "Add manual payment" }).closest("form")!;
    expect(within(manualForm).getByLabelText("Description")).toBeInTheDocument();
    expect(within(manualForm).getByLabelText("Amount per payment (THB)")).toBeInTheDocument();
    expect(within(manualForm).getByRole("combobox", { name: "Frequency" })).toHaveTextContent("One-time payment");
    expect(within(manualForm).getByLabelText("Payment count")).toBeInTheDocument();
    expect(within(manualForm).getByLabelText("Interval months")).toBeInTheDocument();
  });

  it("preloads package terms and submits edited package-plan terms", async () => {
    const assignPackageAction = vi.fn();
    render(createElement(ClientBillingActions, { packages, assignPackageAction, createManualPaymentAction: vi.fn() }));
    const form = screen.getByRole("button", { name: "Assign package" }).closest("form")!;

    expect(within(form).getByRole("combobox", { name: "Payment type" })).toHaveTextContent("Installments");
    expect(within(form).getByLabelText("Total price (THB)")).toHaveValue(1200);
    expect(within(form).getByLabelText("Installments")).toHaveValue(2);
    expect(within(form).getByLabelText("Interval months")).toHaveValue(1);
    fireEvent.change(within(form).getByLabelText("Total price (THB)"), { target: { value: "1800" } });
    fireEvent.change(within(form).getByLabelText("Installments"), { target: { value: "3" } });
    fireEvent.change(within(form).getByLabelText("Interval months"), { target: { value: "2" } });
    fireEvent.change(within(form).getByLabelText("First due date"), { target: { value: "2026-08-31" } });

    fireEvent.click(screen.getByRole("button", { name: "Assign package" }));

    await waitFor(() => expect(assignPackageAction).toHaveBeenCalledTimes(1));
    const submitted = assignPackageAction.mock.calls[0][0] as FormData;
    expect(Object.fromEntries(submitted)).toMatchObject({ package_name: "Extended coaching", payment_type: "INSTALLMENTS", total_price_thb: "1800", installment_count: "3", interval_months: "2", first_due_date: "2026-08-31" });
  });

  it("replaces assignment terms with the selected package defaults", async () => {
    render(createElement(ClientBillingActions, { packages: [...packages, { package_name: "Assessment", total_price_thb: "750", payment_type: "ONE_TIME", installment_count: "1", interval_months: "0" }], assignPackageAction: vi.fn(), createManualPaymentAction: vi.fn() }));
    const form = screen.getByRole("button", { name: "Assign package" }).closest("form")!;

    fireEvent.click(within(form).getByRole("combobox", { name: "Package" }));
    const option = screen.getByRole("option", { name: "Assessment" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.click(option, { pointerType: "mouse" });

    await waitFor(() => expect(within(form).getByRole("combobox", { name: "Payment type" })).toHaveTextContent("One-time payment"));
    expect(within(form).getByLabelText("Total price (THB)")).toHaveValue(750);
    expect(within(form).getByLabelText("Installments")).toHaveValue(1);
    expect(within(form).getByLabelText("Interval months")).toHaveValue(0);
  });

  it("previews exact installment dates and amounts before assigning a package", async () => {
    render(createElement(ClientBillingActions, { packages, assignPackageAction: vi.fn(), createManualPaymentAction: vi.fn() }));
    const form = screen.getByRole("button", { name: "Assign package" }).closest("form")!;

    fireEvent.change(within(form).getByLabelText("First due date"), { target: { value: "2026-01-31" } });

    await waitFor(() => expect(within(form).getByRole("region", { name: "Schedule preview" })).toHaveTextContent("1. 31 Jan 2026 — ฿600.00"));
    expect(within(form).getByRole("region", { name: "Schedule preview" })).toHaveTextContent("2. 28 Feb 2026 — ฿600.00");
  });

  it("submits safe one-time defaults for a manual payment", async () => {
    const createManualPaymentAction = vi.fn();
    render(createElement(ClientBillingActions, { packages, assignPackageAction: vi.fn(), createManualPaymentAction }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Assessment" } });
    fireEvent.change(screen.getByLabelText("Amount per payment (THB)"), { target: { value: "750" } });
    fireEvent.change(screen.getByLabelText("Manual payment first due date"), { target: { value: "2026-08-20" } });

    fireEvent.click(screen.getByRole("button", { name: "Add manual payment" }));

    await waitFor(() => expect(createManualPaymentAction).toHaveBeenCalledTimes(1));
    const submitted = createManualPaymentAction.mock.calls[0][0] as FormData;
    expect(submitted.get("frequency")).toBe("ONE_TIME");
    expect(submitted.get("payment_count")).toBe("1");
    expect(submitted.get("interval_months")).toBe("0");
  });
});

 it("rebalances overrides, blocks invalid totals, and submits fixed amounts", async () => {
    const action = vi.fn();
    render(createElement(ClientBillingActions, { packages, assignPackageAction: action, createManualPaymentAction: vi.fn() }));
    const first = screen.getByLabelText("Installment 1 override (THB)");
    const second = screen.getByLabelText("Installment 2 override (THB)");
    fireEvent.change(first, { target: { value: "200" } });
    expect(second).toHaveAttribute("placeholder", "1000.00");
    fireEvent.change(first, { target: { value: "1200" } });
    expect(screen.getByRole("alert")).toHaveTextContent("leave at least");
    fireEvent.click(screen.getByRole("button", { name: "Assign package" }));
    expect(action).not.toHaveBeenCalled();
    fireEvent.change(first, { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign package" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action.mock.calls[0][0].get("installment_overrides")).toBe('["200",""]');
    fireEvent.change(first, { target: { value: "" } });
    expect(second).toHaveAttribute("placeholder", "600.00");
  });


it.each([
  ["2099-12-15", "15 Dec 2099"],
  ["2000-01-01", "01 Jan 2000"],
  ["", "Choose a first due date"],
])("explains manual payment message timing for %s", (date, expected) => {
  render(createElement(ClientBillingActions, { packages, assignPackageAction: vi.fn(), createManualPaymentAction: vi.fn() }));
  const input = screen.getByLabelText("Manual payment first due date");
  fireEvent.change(input, { target: { value: date } });
  expect(input).toHaveAccessibleDescription(expect.stringContaining(expected));
  expect(input).toHaveAccessibleDescription(date ? `The message will be sent on ${expected}.` : "Choose a first due date.");
});


it("shows the selected package message date", () => {
  render(createElement(ClientBillingActions, { packages, assignPackageAction: vi.fn(), createManualPaymentAction: vi.fn() }));
  const input = screen.getByLabelText("First due date", { exact: true });
  fireEvent.change(input, { target: { value: "2099-12-15" } });
  expect(input).toHaveAccessibleDescription("The message will be sent on 15 Dec 2099.");
});
