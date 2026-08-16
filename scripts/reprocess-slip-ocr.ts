import { runReprocessCommand } from "@/lib/slip/reprocess-command";

async function main(): Promise<void> {
  const report = await runReprocessCommand(process.argv.slice(2));
  console.log(JSON.stringify(report));
  if (report.failed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "OCR reprocess command failed");
  process.exitCode = 1;
});
