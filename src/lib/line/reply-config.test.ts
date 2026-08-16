import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG,
  LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY,
  LineAutomaticReplyConfigError,
  lineSlipReplyText,
  parseLineAutomaticReplyConfig,
  resolveLineAutomaticReplyConfig,
} from "./reply-config";

function customConfig() {
  return {
    version: 2,
    slip: {
      received: "received-custom",
    },
  };
}

describe("LINE automatic reply configuration", () => {
  it("uses the documented neutral slip-received reply when no configuration exists", () => {
    const resolved = resolveLineAutomaticReplyConfig([]);

    expect(resolved.kind).toBe("VALID");
    expect(lineSlipReplyText(resolved.config)).toBe("Payment slip received. We’ll confirm it shortly.");
  });

  it("trims every saved reply before delivery", () => {
    const config = customConfig();
    config.slip.received = "  received custom  ";

    expect(parseLineAutomaticReplyConfig(JSON.stringify(config))).toMatchObject({
      slip: { received: "received custom" },
    });
  });

  it.each([
    ["missing reply", () => ({ version: 2, slip: { received: undefined } })],
    ["unexpected reply", () => ({ version: 2, slip: { ...customConfig().slip, extra: "extra" } })],
    ["unsupported version", () => ({ ...customConfig(), version: 3 })],
    ["overlong reply", () => ({ ...customConfig(), slip: { received: "x".repeat(5001) } })],
  ])("rejects a %s", (_label, makeInvalid) => {
    expect(() => parseLineAutomaticReplyConfig(JSON.stringify(makeInvalid()))).toThrow(LineAutomaticReplyConfigError);
  });

  it("uses documented defaults and marks stored invalid configuration for repair", () => {
    const resolved = resolveLineAutomaticReplyConfig([
      { key: LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY, value: "not-json" },
    ]);

    expect(resolved).toEqual({ kind: "INVALID", config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG });
  });

  it("migrates legacy outcome-specific replies to one neutral received reply", () => {
    const legacy = { ...customConfig(), connection: { linked: "legacy", alreadyLinked: "legacy", invalidOrExpired: "legacy", conflict: "legacy" } };
    legacy.version = 1;
    legacy.slip = { autoRecorded: "recorded-custom", review: "review-custom", flagged: "flagged-custom" } as never;
    const config = parseLineAutomaticReplyConfig(legacy);

    expect(lineSlipReplyText(config)).toBe(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.slip.received);
    expect(config).not.toHaveProperty("connection");
  });
});
