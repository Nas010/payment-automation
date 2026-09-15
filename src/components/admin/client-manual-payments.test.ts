/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import React, { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { buildPackageAssignments } from "@/lib/plans/assignment-lifecycle";
import { ClientManualPayments } from "./client-manual-payments";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const row = { schedule_id: "schedule_1", client_id: "client_1", package_name: "Check-in", payment_type: "ONE_TIME", installment_number: "1", installment_count: "1", amount_thb: "750", due_date: "2026-11-10", status: "SCHEDULED", created_at: "", assignment_id: "manual_1", assignment_kind: "MANUAL" };

it.each(["Cancel payments", "Remove"])("submits the manual plan identity for %s", async (label) => {
  const action = vi.fn();
  render(createElement(ClientManualPayments, { assignments: buildPackageAssignments([row], new Set(), "MANUAL"), cancelAction: action, removeAction: action }));
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect((action.mock.calls[0][0] as FormData).get("assignment_id")).toBe("manual_1");
});

it("hides removed plans and protects recorded payments", () => {
  render(createElement(ClientManualPayments, { assignments: buildPackageAssignments([{ ...row, status: "PAID" }, { ...row, assignment_id: "removed", package_name: "Mistake", status: "DELETED" }], new Set(), "MANUAL"), cancelAction: vi.fn(), removeAction: vi.fn() }));
  expect(screen.queryByText("Mistake")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
});

it("shows action failures and keeps controls usable", async () => {
  render(createElement(ClientManualPayments, { assignments: buildPackageAssignments([row], new Set(), "MANUAL"), cancelAction: vi.fn().mockRejectedValue(new Error("Payment is being delivered; retry shortly")), removeAction: vi.fn() }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel payments" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Payment is being delivered");
  expect(screen.getByRole("button", { name: "Cancel payments" })).toBeEnabled();
});
