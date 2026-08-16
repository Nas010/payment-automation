import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { evaluatePayment } from "@/lib/payments/evaluate";
import { parseSatang } from "@/lib/money";
import { analyzeSlip, type SlipAnalysis } from "./analyze";

type BenchmarkCaseInput = {
  image: string;
  aliases: string[];
  recipientProxySuffix?: string | null;
  amount: string | null;
  createdAt: string | null;
  requireAutoRecord: boolean;
};

export type BenchmarkArguments = { kind: "single"; input: BenchmarkCaseInput } | { kind: "manifest"; path: string };
export type BenchmarkCaseReport = {
  index: number;
  passed: boolean;
  checks: {
    qrValid: boolean;
    transactionReferenceDetected: boolean;
    amountDetected: boolean;
    amountMatchesExpected: boolean | null;
    transactionDateDetected: boolean;
    receiverRecovered: boolean;
  };
  score: number | null;
  decision: string | null;
} | { index: number; passed: false; errorCode: "BENCHMARK_FAILED" };
export type BenchmarkReport = { passed: boolean; cases: BenchmarkCaseReport[] };

export function parseBenchmarkArguments(argumentsList: string[]): BenchmarkArguments {
  let manifest = "";
  let image = "";
  const aliases: string[] = [];
  let amount: string | null = null;
  let createdAt: string | null = null;
  let recipientProxySuffix: string | undefined;
  let requireAutoRecord = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const flag = argumentsList[index];
    if (flag === "--require-auto-record") {
      requireAutoRecord = true;
      continue;
    }
    if (!["--manifest", "--image", "--alias", "--amount", "--created-at", "--recipient-suffix"].includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    index += 1;
    if (flag === "--manifest") manifest = value;
    if (flag === "--image") image = value;
    if (flag === "--alias") aliases.push(value);
    if (flag === "--amount") amount = value;
    if (flag === "--created-at") createdAt = value;
    if (flag === "--recipient-suffix") {
      if (!/^\d{4}$/.test(value)) throw new Error("--recipient-suffix must contain four digits");
      recipientProxySuffix = value;
    }
  }
  if (manifest) {
    if (image || aliases.length || amount || createdAt || recipientProxySuffix || requireAutoRecord) throw new Error("--manifest cannot be combined with single-image arguments");
    return { kind: "manifest", path: manifest };
  }
  if (!image || aliases.length === 0) throw new Error("Usage: npm run ocr:benchmark -- --image <path> --alias <recipient> [--recipient-suffix <last4> --amount <THB> --created-at <ISO> --require-auto-record] or --manifest <path>");
  if (requireAutoRecord && (!amount || !createdAt)) throw new Error("--require-auto-record requires --amount and --created-at");
  return { kind: "single", input: { image, aliases, ...(recipientProxySuffix !== undefined ? { recipientProxySuffix } : {}), amount, createdAt, requireAutoRecord } };
}

function imageType(path: string): "image/jpeg" | "image/png" | "image/webp" {
  const extension = extname(path).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  throw new Error("unsupported image type");
}

function manifestCases(text: string): BenchmarkCaseInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OCR benchmark manifest is invalid");
  }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("OCR benchmark manifest is invalid");
  const cases: BenchmarkCaseInput[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") throw new Error("OCR benchmark manifest is invalid");
    const candidate = item as { image?: unknown; aliases?: unknown; recipientProxySuffix?: unknown; amount?: unknown; createdAt?: unknown };
    if (typeof candidate.image !== "string" || !candidate.image.trim()
      || !Array.isArray(candidate.aliases) || !candidate.aliases.length || !candidate.aliases.every((alias) => typeof alias === "string" && alias.trim())
      || typeof candidate.amount !== "string" || parseSatang(candidate.amount) === null
      || typeof candidate.createdAt !== "string" || Number.isNaN(new Date(candidate.createdAt).getTime())) {
      throw new Error("OCR benchmark manifest is invalid");
    }
    if (candidate.recipientProxySuffix !== undefined && (typeof candidate.recipientProxySuffix !== "string" || !/^\d{4}$/.test(candidate.recipientProxySuffix))) throw new Error("OCR benchmark manifest is invalid");
    cases.push({ image: candidate.image, aliases: [...candidate.aliases] as string[], recipientProxySuffix: candidate.recipientProxySuffix as string | null | undefined, amount: candidate.amount, createdAt: candidate.createdAt, requireAutoRecord: true });
  }
  return cases;
}

export type BenchmarkDependencies = {
  readManifest: (path: string) => Promise<string>;
  readImage: (path: string) => Promise<Uint8Array>;
  analyzeSlip: (bytes: Uint8Array, declaredType: string, aliases: string[], options?: { recipientProxySuffix?: string | null }) => Promise<SlipAnalysis>;
};

const defaultDependencies: BenchmarkDependencies = {
  readManifest: async (path) => readFile(path, "utf8"),
  readImage: async (path) => readFile(path),
  analyzeSlip,
};

async function benchmarkCase(input: BenchmarkCaseInput, index: number, dependencies: BenchmarkDependencies): Promise<BenchmarkCaseReport> {
  try {
    const bytes = await dependencies.readImage(input.image);
    const analysis = await dependencies.analyzeSlip(bytes, imageType(input.image), [...input.aliases], { recipientProxySuffix: input.recipientProxySuffix ?? null });
    const expectedAmountSatang = input.amount ? parseSatang(input.amount) : null;
    if (input.amount && (expectedAmountSatang === null || expectedAmountSatang <= 0)) throw new Error("invalid expected amount");
    if (input.createdAt && Number.isNaN(new Date(input.createdAt).getTime())) throw new Error("invalid creation date");
    const evidenceSignals = analysis.recipientProxyMatch !== undefined || analysis.transferStatus !== undefined
      ? { recipientProxyMatch: analysis.recipientProxyMatch ?? null, transferStatus: analysis.transferStatus ?? "UNKNOWN" as const }
      : {};
    const evaluation = expectedAmountSatang !== null && input.createdAt
      ? evaluatePayment(
        { paymentId: `local-ocr-benchmark-${index}`, amountSatang: expectedAmountSatang, createdAt: input.createdAt, receiverAliases: input.aliases, timezone: "Asia/Bangkok" },
        { imageDuplicate: false, transactionDuplicate: false, qrValid: analysis.qrValid, transactionRef: analysis.transactionRef ?? undefined, amountSatang: analysis.ocrAmountSatang, receiver: analysis.ocrReceiver, transactionDate: analysis.ocrTransactionDate, ...evidenceSignals },
      )
      : null;
    const report = {
      index,
      passed: !input.requireAutoRecord || evaluation?.decision === "AUTO_RECORDED",
      checks: {
        qrValid: analysis.qrValid,
        transactionReferenceDetected: Boolean(analysis.transactionRef),
        amountDetected: analysis.ocrAmountSatang !== null,
        amountMatchesExpected: expectedAmountSatang === null ? null : analysis.ocrAmountSatang === expectedAmountSatang,
        transactionDateDetected: analysis.ocrTransactionDate !== null,
        receiverRecovered: analysis.ocrReceiver !== null && input.aliases.includes(analysis.ocrReceiver),
      },
      score: evaluation?.score ?? null,
      decision: evaluation?.decision ?? null,
    };
    return report;
  } catch {
    return { index, passed: false, errorCode: "BENCHMARK_FAILED" };
  }
}

export async function runOcrBenchmark(argumentsList: string[], dependencies: BenchmarkDependencies = defaultDependencies): Promise<BenchmarkReport> {
  const args = parseBenchmarkArguments(argumentsList);
  let cases: BenchmarkCaseInput[];
  if (args.kind === "single") {
    cases = [args.input];
  } else {
    let manifest: string;
    try {
      manifest = await dependencies.readManifest(args.path);
    } catch {
      throw new Error("OCR benchmark manifest could not be read");
    }
    cases = manifestCases(manifest);
  }
  const reports: BenchmarkCaseReport[] = [];
  for (let index = 0; index < cases.length; index += 1) {
    reports.push(await benchmarkCase(cases[index]!, index + 1, dependencies));
  }
  return { passed: reports.every((report) => report.passed), cases: reports };
}
