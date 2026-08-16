import { runOcrBenchmark } from "@/lib/slip/benchmark-command";

async function main(): Promise<void> {
  const report = await runOcrBenchmark(process.argv.slice(2));
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "OCR benchmark failed");
  process.exitCode = 1;
});
