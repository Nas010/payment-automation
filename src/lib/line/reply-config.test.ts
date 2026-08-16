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
    version: 1,
    slip: {
      autoRecorded: "recorded-custom",
      review: "review-custom",
      flagged: "flagged-custom",
    },
  };
}

describe("LINE automatic reply configuration", () => {
  it("uses the documented recorded-slip reply when no configuration exists", () => {
    const resolved = resolveLineAutomaticReplyConfig([]);

    expect(resolved.kind).toBe("VALID");
    expect(lineSlipReplyText(resolved.config, "AUTO_RECORDED")).toBe("Payment slip received and recorded.");
  });

  it("trims every saved reply before delivery", () => {
    const config = customConfig();
    config.slip.autoRecorded = "  recorded custom  ";

    expect(parseLineAutomaticReplyConfig(JSON.stringify(config))).toMatchObject({
      slip: { autoRecorded: "recorded custom" },
    });
  });

  it.each([
    ["missing reply", () => ({ version: 1, slip: { ...customConfig().slip, review: undefined } })],
    ["unexpected reply", () => ({ version: 1, slip: { ...customConfig().slip, extra: "extra" } })],
    ["unsupported version", () => ({ ...customConfig(), version: 2 })],
    ["overlong reply", () => ({ ...customConfig(), slip: { ...customConfig().slip, flagged: "x".repeat(5001) } })],
  ])("rejects a %s", (_label, makeInvalid) => {
    expect(() => parseLineAutomaticReplyConfig(JSON.stringify(makeInvalid()))).toThrow(LineAutomaticReplyConfigError);
  });

  it("uses documented defaults and marks stored invalid configuration for repair", () => {
    const resolved = resolveLineAutomaticReplyConfig([
      { key: LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY, value: "not-json" },
    ]);

    expect(resolved).toEqual({ kind: "INVALID", config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG });
  });

  it("keeps slip replies from legacy saved settings while dropping retired connection replies", () => {
    const legacy = { ...customConfig(), connection: { linked: "legacy", alreadyLinked: "legacy", invalidOrExpired: "legacy", conflict: "legacy" } };
    const config = parseLineAutomaticReplyConfig(legacy);

    expect(lineSlipReplyText(config, "AUTO_RECORDED")).toBe("recorded-custom");
    expect(lineSlipReplyText(config, "MANUAL_CONFIRMED")).toBe("review-custom");
    expect(lineSlipReplyText(config, "REVIEW")).toBe("review-custom");
    expect(lineSlipReplyText(config, "FLAGGED")).toBe("flagged-custom");
    expect(config).not.toHaveProperty("connection");
  });
});
