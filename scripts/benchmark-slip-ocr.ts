import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { evaluatePayment } from "@/lib/payments/evaluate";
import { parseSatang } from "@/lib/money";
import { analyzeSlip } from "@/lib/slip/analyze";

type BenchmarkArgs = {
  image: string;
  aliases: string[];
  amount: string | null;
  createdAt: string | null;
  requireAutoRecord: boolean;
};

function argumentsForBenchmark(argumentsList: string[]): BenchmarkArgs {
  let image = "";
  const aliases: string[] = [];
  let amount: string | null = null;
  let createdAt: string | null = null;
  let requireAutoRecord = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const flag = argumentsList[index];
    if (flag === "--require-auto-record") {
      requireAutoRecord = true;
      continue;
    }
    if (!["--image", "--alias", "--amount", "--created-at"].includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    index += 1;
    if (flag === "--image") image = value;
    if (flag === "--alias") aliases.push(value);
    if (flag === "--amount") amount = value;
    if (flag === "--created-at") createdAt = value;
  }
  if (!image || aliases.length === 0) throw new Error("Usage: npm run ocr:benchmark -- --image <path> --alias <recipient> [--alias <recipient>] [--amount <THB> --created-at <ISO> --require-auto-record]");
  if (requireAutoRecord && (!amount || !createdAt)) throw new Error("--require-auto-record requires --amount and --created-at");
  return { image, aliases, amount, createdAt, requireAutoRecord };
}

function imageType(path: string): "image/jpeg" | "image/png" | "image/webp" {
  const extension = extname(path).toLowerCase();
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  throw new Error("Image must use a .jpg, .jpeg, .png, or .webp extension");
}

async function main(): Promise<void> {
  const args = argumentsForBenchmark(process.argv.slice(2));
  const bytes = await readFile(args.image);
  const analysis = await analyzeSlip(bytes, imageType(args.image), args.aliases);
  const expectedAmountSatang = args.amount ? parseSatang(args.amount) : null;
  if (args.amount && (expectedAmountSatang === null || expectedAmountSatang <= 0)) throw new Error("--amount must be a positive THB value");
  if (args.createdAt && Number.isNaN(new Date(args.createdAt).getTime())) throw new Error("--created-at must be an ISO timestamp");

  const evaluation = expectedAmountSatang !== null && args.createdAt
    ? evaluatePayment(
      { paymentId: "local-ocr-benchmark", amountSatang: expectedAmountSatang, createdAt: args.createdAt, receiverAliases: args.aliases, timezone: "Asia/Bangkok" },
      { imageDuplicate: false, transactionDuplicate: false, qrValid: analysis.qrValid, transactionRef: analysis.transactionRef ?? undefined, amountSatang: analysis.ocrAmountSatang, receiver: analysis.ocrReceiver, transactionDate: analysis.ocrTransactionDate },
    )
    : null;
  const receiverRecovered = analysis.ocrReceiver !== null && args.aliases.includes(analysis.ocrReceiver);
  const report = {
    checks: {
      qrValid: analysis.qrValid,
      transactionReferenceDetected: Boolean(analysis.transactionRef),
      amountDetected: analysis.ocrAmountSatang !== null,
      amountMatchesExpected: expectedAmountSatang === null ? null : analysis.ocrAmountSatang === expectedAmountSatang,
      transactionDateDetected: analysis.ocrTransactionDate !== null,
      receiverRecovered,
    },
    score: evaluation?.score ?? null,
    decision: evaluation?.decision ?? null,
  };
  console.log(JSON.stringify(report));
  if (args.requireAutoRecord && evaluation?.decision !== "AUTO_RECORDED") throw new Error("OCR benchmark did not meet the required AUTO_RECORDED decision");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "OCR benchmark failed");
  process.exitCode = 1;
});
