import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG,
  LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY,
  LineAutomaticReplyConfigError,
  lineConnectionReplyText,
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
    connection: {
      linked: "linked-custom",
      alreadyLinked: "already-custom",
      invalidOrExpired: "invalid-custom",
      conflict: "conflict-custom",
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
    config.connection.linked = "  linked custom  ";

    expect(parseLineAutomaticReplyConfig(JSON.stringify(config))).toMatchObject({
      slip: { autoRecorded: "recorded custom" },
      connection: { linked: "linked custom" },
    });
  });

  it.each([
    ["missing reply", () => ({ version: 1, slip: { ...customConfig().slip, review: undefined }, connection: customConfig().connection })],
    ["unexpected reply", () => ({ version: 1, slip: { ...customConfig().slip, extra: "extra" }, connection: customConfig().connection })],
    ["unsupported version", () => ({ ...customConfig(), version: 2 })],
    ["blank reply", () => ({ ...customConfig(), connection: { ...customConfig().connection, conflict: "   " } })],
    ["overlong reply", () => ({ ...customConfig(), slip: { ...customConfig().slip, flagged: "x".repeat(5001) } })],
  ])("rejects a %s", (_label, makeInvalid) => {
    expect(() => parseLineAutomaticReplyConfig(JSON.stringify(makeInvalid()))).toThrow(LineAutomaticReplyConfigError);
  });

  it("uses documented defaults and marks stored invalid configuration for repair", () => {
    const resolved = resolveLineAutomaticReplyConfig([
      { key: LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY, value: "not-json" },
    ]);

    expect(resolved).toEqual({ kind: "INVALID", config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG });
    expect(lineConnectionReplyText(resolved.config, "LINKED")).toContain("Your coaching account is now linked");
  });

  it("routes every slip and connection outcome to its configured reply", () => {
    const config = parseLineAutomaticReplyConfig(customConfig());

    expect(lineSlipReplyText(config, "AUTO_RECORDED")).toBe("recorded-custom");
    expect(lineSlipReplyText(config, "MANUAL_CONFIRMED")).toBe("review-custom");
    expect(lineSlipReplyText(config, "REVIEW")).toBe("review-custom");
    expect(lineSlipReplyText(config, "FLAGGED")).toBe("flagged-custom");
    expect(lineConnectionReplyText(config, "LINKED")).toBe("linked-custom");
    expect(lineConnectionReplyText(config, "ALREADY_LINKED")).toBe("already-custom");
    expect(lineConnectionReplyText(config, "INVALID_OR_EXPIRED")).toBe("invalid-custom");
    expect(lineConnectionReplyText(config, "CLIENT_INACTIVE")).toBe("invalid-custom");
    expect(lineConnectionReplyText(config, "CONFLICT")).toBe("conflict-custom");
  });
});
