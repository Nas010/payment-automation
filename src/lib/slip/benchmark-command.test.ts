import { describe, expect, it, vi } from "vitest";
import type { SlipAnalysis } from "./analyze";
import { parseBenchmarkArguments, runOcrBenchmark } from "./benchmark-command";

function analysis(overrides: Partial<SlipAnalysis> = {}): SlipAnalysis {
  return {
    imageHash: "private-image-hash",
    qrPayloadHash: "private-qr-hash",
    qrValid: true,
    transactionRef: "PRIVATE-REFERENCE",
    originatingBank: "004",
    ocrAmountSatang: 590000,
    ocrReceiver: "นางสาว พีรพร บุญสนิท",
    ocrTransactionDate: "2026-08-16T02:51:00.000Z",
    reasons: [],
    ...overrides,
    recipientProxyMatch: overrides.recipientProxyMatch ?? true,
    transferStatus: overrides.transferStatus ?? "SUCCESS",
  };
}

describe("parseBenchmarkArguments", () => {
  it("preserves the existing single-image command", () => {
    expect(parseBenchmarkArguments([
      "--image", "/private/slip.jpeg",
      "--alias", "Private Recipient",
      "--amount", "5900",
      "--created-at", "2026-08-16T00:00:00.000Z",
      "--require-auto-record",
    ])).toEqual({
      kind: "single",
      input: {
        image: "/private/slip.jpeg",
        aliases: ["Private Recipient"],
        amount: "5900",
        createdAt: "2026-08-16T00:00:00.000Z",
        requireAutoRecord: true,
      },
    });
  });

  it("accepts one exclusive private manifest", () => {
    expect(parseBenchmarkArguments(["--manifest", "/private/cases.json"])).toEqual({ kind: "manifest", path: "/private/cases.json" });
    expect(() => parseBenchmarkArguments(["--manifest", "/private/cases.json", "--image", "/private/slip.jpeg"])).toThrow("--manifest cannot be combined with single-image arguments");
  });
});

describe("runOcrBenchmark", () => {
  it("runs every private manifest case and emits only aggregate checks", async () => {
    const privateManifest = JSON.stringify([
      { image: "/private/scb-secret.jpeg", aliases: ["นางสาว พีรพร บุญสนิท"], amount: "5900", createdAt: "2026-08-16T00:00:00.000Z" },
      { image: "/private/kplus-secret.jpeg", aliases: ["นางสาว พีรพร บุญสนิท"], amount: "5900", createdAt: "2026-08-16T00:00:00.000Z" },
    ]);
    const analyzeSlip = vi.fn(async () => analysis());

    const report = await runOcrBenchmark(["--manifest", "/private/cases.json"], {
      readManifest: vi.fn(async () => privateManifest),
      readImage: vi.fn(async () => new Uint8Array([1, 2, 3])),
      analyzeSlip,
    });

    expect(report).toEqual({
      passed: true,
      cases: [1, 2].map((index) => ({
        index,
        passed: true,
        checks: {
          qrValid: true,
          transactionReferenceDetected: true,
          amountDetected: true,
          amountMatchesExpected: true,
          transactionDateDetected: true,
          receiverRecovered: true,
        },
        score: 100,
        decision: "AUTO_RECORDED",
      })),
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("พีรพร");
    expect(serialized).not.toContain("5900");
    expect(serialized).not.toContain("REFERENCE");
  });

  it("marks a required case failed without emitting OCR content", async () => {
    const report = await runOcrBenchmark([
      "--image", "/private/slip.jpeg",
      "--alias", "Private Recipient",
      "--amount", "5900",
      "--created-at", "2026-08-16T00:00:00.000Z",
      "--require-auto-record",
    ], {
      readManifest: vi.fn(),
      readImage: vi.fn(async () => new Uint8Array([1, 2, 3])),
      analyzeSlip: vi.fn(async () => analysis({ ocrAmountSatang: null, ocrReceiver: "Private Recipient" })),
    });

    expect(report).toMatchObject({ passed: false, cases: [{ index: 1, passed: false, decision: "REVIEW" }] });
    expect(JSON.stringify(report)).not.toContain("Private Recipient");
  });

  it("sanitizes per-image failures and continues the manifest", async () => {
    const privateManifest = JSON.stringify([
      { image: "/private/broken-secret.jpeg", aliases: ["Private Recipient"], amount: "5900", createdAt: "2026-08-16T00:00:00.000Z" },
      { image: "/private/good-secret.jpeg", aliases: ["Private Recipient"], amount: "5900", createdAt: "2026-08-16T00:00:00.000Z" },
    ]);
    const readImage = vi.fn()
      .mockRejectedValueOnce(new Error("/private/broken-secret.jpeg cannot be opened"))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

    const report = await runOcrBenchmark(["--manifest", "/private/cases.json"], {
      readManifest: vi.fn(async () => privateManifest),
      readImage,
      analyzeSlip: vi.fn(async () => analysis({ ocrReceiver: "Private Recipient" })),
    });

    expect(report).toMatchObject({ passed: false, cases: [{ index: 1, passed: false, errorCode: "BENCHMARK_FAILED" }, { index: 2, passed: true }] });
    expect(JSON.stringify(report)).not.toContain("broken-secret");
  });
});
