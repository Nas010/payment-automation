import { describe, expect, it } from "vitest";
import { detectTransactionDuplicate } from "./duplicates";

describe("detectTransactionDuplicate", () => {
  it("is idempotent for same payment and flags a different payment", () => {
    const history = [{ payment_id: "a", transaction_ref: "TX-9", originating_bank: "014" }, { payment_id: "b", transaction_ref: "", originating_bank: "" }];
    expect(detectTransactionDuplicate(history, "a", "014", "TX-9")).toBe(false);
    expect(detectTransactionDuplicate(history, "b", "014", "TX-9")).toBe(true);
  });
});
