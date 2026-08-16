import { z } from "zod";

export const LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY = "line_automatic_reply_config";

const messageSchema = z.string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(5000));

const automaticReplyConfigSchema = z.object({
  version: z.literal(2),
  slip: z.object({
    received: messageSchema,
  }).strict(),
}).strict();

const legacyAutomaticReplyConfigSchema = z.object({
  version: z.literal(1),
  slip: z.object({
    autoRecorded: messageSchema,
    review: messageSchema,
    flagged: messageSchema,
  }).strict(),
}).strict();

export type LineAutomaticReplyConfig = z.infer<typeof automaticReplyConfigSchema>;
export type ResolvedLineAutomaticReplyConfig = {
  kind: "VALID" | "INVALID";
  config: LineAutomaticReplyConfig;
};

export const DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG: LineAutomaticReplyConfig = {
  version: 2,
  slip: {
    received: "Payment slip received. We’ll confirm it shortly.",
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
      const currentConfig = automaticReplyConfigSchema.safeParse(current);
      if (currentConfig.success) return currentConfig.data;
      legacyAutomaticReplyConfigSchema.parse(current);
      return DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG;
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

export function lineSlipReplyText(config: LineAutomaticReplyConfig): string {
  return config.slip.received;
}
