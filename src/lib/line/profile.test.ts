import { describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";
import * as profileModule from "./profile";
import { lineProfilePictureStatus, normalizeLinePictureUrl } from "./profile";

const now = "2026-08-10T12:00:00.000Z";
const userId = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: userId, line_display_name: "Old", line_picture_url: "", package_name: "PT", payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10", default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: now, updated_at: now,
    line_link_code: "", line_link_code_expires_at: "", line_link_status: "LINKED", line_linked_at: now, line_link_message: "", line_link_error: "", line_link_token_hash: "", line_link_token_encrypted: "", line_link_token_expires_at: "",
    ...overrides,
  };
}

describe("normalizeLinePictureUrl", () => {
  it("keeps HTTPS picture URLs returned by LINE's authenticated profile API", () => {
    expect(normalizeLinePictureUrl("https://profile.line-scdn.net/avatar/path?size=large")).toBe("https://profile.line-scdn.net/avatar/path?size=large");
    expect(normalizeLinePictureUrl("https://obs.line-apps.com/avatar/path")).toBe("https://obs.line-apps.com/avatar/path");
    expect(normalizeLinePictureUrl("https://profile-cdn.example.test/avatar/path")).toBe("https://profile-cdn.example.test/avatar/path");
  });

  it.each([
    undefined,
    "",
    "http://profile.line-scdn.net/avatar",
    "ftp://profile.line-scdn.net/avatar",
    "not-a-url",
  ])("removes unsafe picture value %s", (value) => {
    expect(normalizeLinePictureUrl(value)).toBe("");
  });

  it("classifies absent and rejected images without returning their value", () => {
    expect(lineProfilePictureStatus(undefined)).toBe("missing");
    expect(lineProfilePictureStatus("ftp://profile.line-scdn.net/avatar")).toBe("rejected");
  });
});

describe("persistLineProfile", () => {
  it("updates trusted profile fields only for the currently linked user", async () => {
    const persistLineProfile = (profileModule as unknown as { persistLineProfile?: (dependencies: unknown, input: unknown) => Promise<boolean> }).persistLineProfile;
    expect(persistLineProfile).toBeTypeOf("function");
    if (!persistLineProfile) return;
    const updateLineLinkClient = vi.fn(async () => true);
    const dependencies = { listClients: vi.fn(async () => [client()]), updateLineLinkClient };

    await expect(persistLineProfile(dependencies, { lineUserId: userId, displayName: "Nisa LINE", pictureUrl: "https://profile.line-scdn.net/avatar/path", now })).resolves.toBe(true);
    expect(updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({
      expectedClient: expect.objectContaining({ client_id: "client_1" }),
      client: expect.objectContaining({ line_display_name: "Nisa LINE", line_picture_url: "https://profile.line-scdn.net/avatar/path", updated_at: now }),
    }));
  });

  it("rejects review mappings and stale optimistic updates", async () => {
    const persistLineProfile = (profileModule as unknown as { persistLineProfile?: (dependencies: unknown, input: unknown) => Promise<boolean> }).persistLineProfile;
    expect(persistLineProfile).toBeTypeOf("function");
    if (!persistLineProfile) return;
    const updateLineLinkClient = vi.fn(async () => false);

    await expect(persistLineProfile({ listClients: vi.fn(async () => [client({ line_link_status: "REVIEW" })]), updateLineLinkClient }, { lineUserId: userId, displayName: "Nisa", pictureUrl: "", now })).resolves.toBe(false);
    await expect(persistLineProfile({ listClients: vi.fn(async () => [client()]), updateLineLinkClient }, { lineUserId: userId, displayName: "=Nisa", pictureUrl: "", now })).resolves.toBe(false);
    expect(updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ line_display_name: "'=Nisa", line_picture_url: "" }) }));
  });
});
