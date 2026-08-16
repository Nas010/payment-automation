/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ClientPackageAssignments } from "./client-package-assignments";

const packages = [
  { package_name: "Premium coaching", total_price_thb: "1500", payment_type: "INSTALLMENTS", installment_count: "3", interval_months: "1" },
];

const actions = () => ({
  change: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  end: vi.fn(),
  remove: vi.fn(),
});

const coaching = {
  id: "assignment_1",
  kind: "PACKAGE" as const,
  clientId: "client_1",
  label: "Coaching",
  paymentType: "INSTALLMENTS",
  installmentCount: "2",
  createdAt: "2026-08-01T00:00:00.000Z",
  state: "ACTIVE" as const,
  paidSatang: 50000,
  outstandingSatang: 50000,
  nextDueDate: "2026-09-01",
  schedules: [],
};

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClientPackageAssignments", () => {
  it("shows an active package's progress and submits replacement details", async () => {
    const action = actions();
    const { container } = render(createElement(ClientPackageAssignments, {
      assignments: [coaching],
      packages,
      changePackageAssignmentAction: action.change,
      pausePackageAssignmentAction: action.pause,
      resumePackageAssignmentAction: action.resume,
      endPackageAssignmentAction: action.end,
      deletePackageAssignmentAction: action.remove,
    }));

    expect(screen.getByRole("heading", { name: "Package assignments" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Coaching" })).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getAllByText("฿500.00", { exact: false })).toHaveLength(2);
    expect(screen.getByText("Remaining")).toBeInTheDocument();
    expect(screen.getByText("01 Sept 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change package" })).toBeInTheDocument();
    expect(screen.queryByText("Extra session")).toBeNull();

    expect(screen.getByRole("combobox", { name: "New package" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("First due date"), { target: { value: "2026-09-01" } });
    fireEvent.submit(container.querySelector('form[aria-label="Change Coaching"]')!);

    await waitFor(() => expect(action.change).toHaveBeenCalledOnce());
    const submitted = action.change.mock.calls[0][0] as FormData;
    expect(Object.fromEntries(submitted)).toMatchObject({
      assignment_id: "assignment_1",
      package_name: "Premium coaching",
      first_due_date: "2026-09-01",
    });
  });

  it("offers only package replacement for a completed paid-in-full assignment", () => {
    const action = actions();
    render(createElement(ClientPackageAssignments, {
      assignments: [{ ...coaching, state: "COMPLETED", paymentType: "ONE_TIME", paidSatang: 120000, outstandingSatang: 0, nextDueDate: "" }],
      packages,
      changePackageAssignmentAction: action.change,
      pausePackageAssignmentAction: action.pause,
      resumePackageAssignmentAction: action.resume,
      endPackageAssignmentAction: action.end,
      deletePackageAssignmentAction: action.remove,
    }));

    expect(screen.getByText("Deletion unavailable after a recorded payment.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete package" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End" })).toBeNull();
    expect(screen.getByRole("button", { name: "Change package" })).toBeInTheDocument();
  });
});
