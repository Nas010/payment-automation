import { runtimeConfig } from "@/lib/runtime-config";
import { reprocessStoredSlipEvidence, type ReprocessSlipInput, type ReprocessSlipReport } from "./reprocess";

export type ReprocessArguments = { paymentIds: string[]; applyEvidence: boolean };
export type ReprocessCommandResult = {
  mode: "dry-run" | "apply-evidence";
  failed: boolean;
  results: Array<({ index: number; ok: true } & ReprocessSlipReport) | { index: number; ok: false; errorCode: string }>;
};

export function parseReprocessArguments(argumentsList: string[]): ReprocessArguments {
  const paymentIds: string[] = [];
  let applyEvidence = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const flag = argumentsList[index];
    if (flag === "--apply-evidence") {
      applyEvidence = true;
      continue;
    }
    if (flag !== "--payment-id") throw new Error(`Unknown argument: ${flag}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--payment-id requires a value");
    paymentIds.push(value);
    index += 1;
  }
  const uniquePaymentIds = [...new Set(paymentIds)];
  if (!uniquePaymentIds.length) throw new Error("At least one --payment-id is required");
  return { paymentIds: uniquePaymentIds, applyEvidence };
}

export type ReprocessCommandDependencies = {
  loadOcrSettings: () => Promise<{ receiverAliases: string[]; ocrEnabled: boolean }>;
  reprocess: (input: ReprocessSlipInput) => Promise<ReprocessSlipReport>;
};

const defaultDependencies: ReprocessCommandDependencies = {
  loadOcrSettings: async () => {
    const config = await runtimeConfig();
    return {
      receiverAliases: [config.recipientNameEn, config.recipientNameTh, ...config.recipientAliases].filter(Boolean),
      ocrEnabled: config.ocrEnabled,
    };
  },
  reprocess: reprocessStoredSlipEvidence,
};

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Payment was not found") return "PAYMENT_NOT_FOUND";
  if (message === "Only REVIEW or FLAGGED payments can be reprocessed") return "STATUS_NOT_ELIGIBLE";
  if (/^(Retained private slip|Private slip) is unavailable/.test(message)) return "SLIP_UNAVAILABLE";
  if (message.startsWith("Payment changed")) return "PAYMENT_CHANGED";
  if (message === "Evidence apply requires all checks to pass") return "CHECKS_FAILED";
  if (message === "Payment amount is invalid") return "PAYMENT_CONFIG_INVALID";
  return "REPROCESS_FAILED";
}

export async function runReprocessCommand(argumentsList: string[], dependencies: ReprocessCommandDependencies = defaultDependencies): Promise<ReprocessCommandResult> {
  const args = parseReprocessArguments(argumentsList);
  const settings = await dependencies.loadOcrSettings();
  const receiverAliases = [...settings.receiverAliases];
  const results: ReprocessCommandResult["results"] = [];
  for (let index = 0; index < args.paymentIds.length; index += 1) {
    try {
      const report = await dependencies.reprocess({
        paymentId: args.paymentIds[index]!,
        receiverAliases,
        ocrEnabled: settings.ocrEnabled,
        applyEvidence: args.applyEvidence,
      });
      results.push({ index: index + 1, ok: true, ...report });
    } catch (error) {
      results.push({ index: index + 1, ok: false, errorCode: errorCode(error) });
    }
  }
  return { mode: args.applyEvidence ? "apply-evidence" : "dry-run", failed: results.some((result) => !result.ok), results };
}
