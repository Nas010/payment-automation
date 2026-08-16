import { describe, expect, it, vi } from "vitest";
import { parseReprocessArguments, runReprocessCommand } from "./reprocess-command";

const passingReport = {
  applied: false,
  decision: "AUTO_RECORDED" as const,
  score: 100,
  checks: {
    qrValid: true,
    transactionReferenceDetected: true,
    amountDetected: true,
    amountMatchesExpected: true,
    transactionDateDetected: true,
    receiverRecovered: true,
  },
  diagnostics: [],
};

describe("parseReprocessArguments", () => {
  it("accepts explicit repeated payment IDs and defaults to dry-run", () => {
    expect(parseReprocessArguments(["--payment-id", "pay_one", "--payment-id", "pay_two"])).toEqual({
      paymentIds: ["pay_one", "pay_two"],
      applyEvidence: false,
    });
  });

  it("deduplicates IDs and requires an explicit apply flag for writes", () => {
    expect(parseReprocessArguments(["--apply-evidence", "--payment-id", "pay_one", "--payment-id", "pay_one"])).toEqual({
      paymentIds: ["pay_one"],
      applyEvidence: true,
    });
  });

  it.each([
    [[], "At least one --payment-id is required"],
    [["--payment-id"], "--payment-id requires a value"],
    [["--unknown"], "Unknown argument: --unknown"],
  ])("rejects unsafe argument set %#", (argumentsList, message) => {
    expect(() => parseReprocessArguments(argumentsList)).toThrow(message);
  });
});

describe("runReprocessCommand", () => {
  it("freezes one alias set and returns reports without payment IDs", async () => {
    const reprocess = vi.fn(async () => passingReport);

    const result = await runReprocessCommand(["--payment-id", "pay_secret_one", "--payment-id", "pay_secret_two"], {
      loadOcrSettings: vi.fn(async () => ({ receiverAliases: ["NAS O"], ocrEnabled: true })),
      reprocess,
    });

    expect(reprocess).toHaveBeenNthCalledWith(1, { paymentId: "pay_secret_one", receiverAliases: ["NAS O"], ocrEnabled: true, applyEvidence: false });
    expect(reprocess).toHaveBeenNthCalledWith(2, { paymentId: "pay_secret_two", receiverAliases: ["NAS O"], ocrEnabled: true, applyEvidence: false });
    expect(result).toEqual({ mode: "dry-run", failed: false, results: [{ index: 1, ok: true, ...passingReport }, { index: 2, ok: true, ...passingReport }] });
    expect(JSON.stringify(result)).not.toContain("pay_secret");
    expect(JSON.stringify(result)).not.toContain("NAS O");
  });

  it("maps per-payment failures to fixed codes and continues the batch", async () => {
    const reprocess = vi.fn()
      .mockRejectedValueOnce(new Error("Retained private slip is unavailable"))
      .mockResolvedValueOnce(passingReport);

    const result = await runReprocessCommand(["--apply-evidence", "--payment-id", "pay_one", "--payment-id", "pay_two"], {
      loadOcrSettings: vi.fn(async () => ({ receiverAliases: ["NAS O"], ocrEnabled: true })),
      reprocess,
    });

    expect(result).toEqual({
      mode: "apply-evidence",
      failed: true,
      results: [
        { index: 1, ok: false, errorCode: "SLIP_UNAVAILABLE" },
        { index: 2, ok: true, ...passingReport },
      ],
    });
  });
});
