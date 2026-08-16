import { z } from "zod";

export const LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY = "line_automatic_reply_config";

const messageSchema = z.string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(5000));

const automaticReplyConfigSchema = z.object({
  version: z.literal(1),
  slip: z.object({
    autoRecorded: messageSchema,
    review: messageSchema,
    flagged: messageSchema,
  }).strict(),
}).strict();

export type LineAutomaticReplyConfig = z.infer<typeof automaticReplyConfigSchema>;
export type LineSlipReplyDecision = "AUTO_RECORDED" | "MANUAL_CONFIRMED" | "REVIEW" | "FLAGGED";
export type ResolvedLineAutomaticReplyConfig = {
  kind: "VALID" | "INVALID";
  config: LineAutomaticReplyConfig;
};

export const DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG: LineAutomaticReplyConfig = {
  version: 1,
  slip: {
    autoRecorded: "Payment slip received and recorded.",
    review: "Payment slip received. It will be reviewed.",
    flagged: "Payment slip received. Please contact your trainer so they can review it.",
  },
};

export class LineAutomaticReplyConfigError extends Error {
  constructor() {
    super("LINE automatic reply configuration is invalid");
    this.name = "LineAutomaticReplyConfigError";
  }
}

export function parseLineAutomaticReplyConfig(value: unknown): LineAutomaticReplyConfig {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const current = { ...(parsed as Record<string, unknown>) };
      delete current.connection;
      return automaticReplyConfigSchema.parse(current);
    }
    return automaticReplyConfigSchema.parse(parsed);
  } catch {
    throw new LineAutomaticReplyConfigError();
  }
}

export function resolveLineAutomaticReplyConfig(settings: ReadonlyArray<{ key: string; value: string }>): ResolvedLineAutomaticReplyConfig {
  const stored = settings.find((setting) => setting.key === LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY)?.value;
  if (stored === undefined) return { kind: "VALID", config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG };
  try {
    return { kind: "VALID", config: parseLineAutomaticReplyConfig(stored) };
  } catch {
    return { kind: "INVALID", config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG };
  }
}

export function lineSlipReplyText(config: LineAutomaticReplyConfig, decision: LineSlipReplyDecision): string {
  switch (decision) {
    case "AUTO_RECORDED": return config.slip.autoRecorded;
    case "FLAGGED": return config.slip.flagged;
    case "MANUAL_CONFIRMED":
    case "REVIEW": return config.slip.review;
  }
}
