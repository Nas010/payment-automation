import { describe, expect, it } from "vitest";
import { requiredConfiguration } from "./config";

describe("requiredConfiguration", () => {
  it("reports required values without exposing their values", () => {
    expect(requiredConfiguration({})).toEqual(["SPREADSHEET_ID", "GOOGLE_SERVICE_ACCOUNT_JSON", "PROMPTPAY_IDENTIFIER", "RECIPIENT_NAME_EN"]);
  });
});
