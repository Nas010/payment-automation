import { describe, expect, it } from "vitest";
import { lineLinkStatus } from "./line-link-state";

describe("lineLinkStatus", () => {
  it("treats migrated legacy LINE mappings as linked regardless of stale status", () => {
    expect(lineLinkStatus({ line_user_id: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", line_link_status: "", line_link_code_expires_at: "" })).toBe("LINKED");
    expect(lineLinkStatus({ line_user_id: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", line_link_status: "CODE_ACTIVE", line_link_code_expires_at: "2099-01-01T00:00:00.000Z" })).toBe("LINKED");
  });
});
