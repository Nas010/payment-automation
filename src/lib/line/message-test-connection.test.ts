import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord, LineLinkClaimResult } from "@/lib/sheets/clients";
import { hashLineConnectionToken, recoverLineConnectionToken } from "./connection-token";
import type { LineMessageTestProfile } from "./message-test-profile";
import { createLineMessageTestConnectionService, type LineMessageTestConnectionDependencies } from "./message-test-connection";

const encryptionKey = Buffer.alloc(32, 8).toString("base64");
const now = "2026-08-15T00:00:00.000Z";
const token = "A".repeat(43);
const lineUserId = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function profile(overrides: Partial<LineMessageTestProfile> = {}): LineMessageTestProfile {
  return {
    version: 1, clientName: "Test Client", packageName: "Test Package", totalPriceThb: "3000",
    paymentType: "INSTALLMENTS", installmentCount: 3, intervalMonths: 1, firstDueDate: "2026-08-15",
    lineUserId: "", lineDisplayName: "", linePictureUrl: "", lineLinkStatus: "", lineLinkedAt: "", lineLinkError: "",
    lineLinkTokenHash: "", lineLinkTokenEncrypted: "", lineLinkTokenExpiresAt: "", updatedAt: now,
    ...overrides,
  };
}

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Real Client", line_user_id: "", line_display_name: "", line_picture_url: "", package_name: "PT", payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-15", default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-15", notes: "", created_at: now, updated_at: now,
    line_link_code: "", line_link_code_expires_at: "", line_link_status: "", line_linked_at: "", line_link_message: "", line_link_error: "", line_link_token_hash: "", line_link_token_encrypted: "", line_link_token_expires_at: "",
    ...overrides,
  };
}

function dependencies(current: LineMessageTestProfile): LineMessageTestConnectionDependencies & Record<string, ReturnType<typeof vi.fn>> {
  let stored = current;
  return {
    getProfile: vi.fn(async () => stored),
    listClients: vi.fn(async () => []),
    updateProfileIfUnchanged: vi.fn(async ({ profile: next }: { profile: LineMessageTestProfile }) => { stored = next; return true; }),
    claimConnection: vi.fn(async ({ profile: next }: { profile: LineMessageTestProfile }): Promise<LineLinkClaimResult> => { stored = next; return "CLAIMED"; }),
    disconnectConnection: vi.fn(async ({ profile: next }: { profile: LineMessageTestProfile }) => { stored = next; return true; }),
    appendAudit: vi.fn(async () => undefined),
    tokenGenerator: vi.fn(() => token),
  } as LineMessageTestConnectionDependencies & Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(() => vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey));
afterEach(() => vi.unstubAllEnvs());

describe("LINE message test connection service", () => {
  it("issues an encrypted seven-day test-scoped LIFF token", async () => {
    const deps = dependencies(profile());
    const issued = await createLineMessageTestConnectionService(deps).issue({ now });

    expect(issued.lineLinkStatus).toBe("LINK_ACTIVE");
    expect(issued.lineLinkTokenHash).toBe(hashLineConnectionToken(token));
    expect(issued.lineLinkTokenExpiresAt).toBe("2026-08-22T00:00:00.000Z");
    expect(recoverLineConnectionToken({ clientId: "line-message-test-profile", encryptedToken: issued.lineLinkTokenEncrypted })).toBe(token);
  });

  it("claims verified LINE identity atomically and audits only its suffix", async () => {
    const deps = dependencies(profile({
      lineLinkStatus: "LINK_ACTIVE",
      lineLinkTokenHash: hashLineConnectionToken(token),
      lineLinkTokenEncrypted: "encrypted",
      lineLinkTokenExpiresAt: "2026-08-22T00:00:00.000Z",
    }));

    await expect(createLineMessageTestConnectionService(deps).claim({ token, lineUserId, displayName: "=Test", pictureUrl: "https://profile.line-scdn.net/avatar/path", now })).resolves.toBe("LINKED");
    expect(deps.claimConnection).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: hashLineConnectionToken(token), lineUserId, profile: expect.objectContaining({ lineUserId, lineDisplayName: "'=Test", lineLinkStatus: "LINKED", lineLinkTokenEncrypted: "" }) }));
    const auditJson = JSON.stringify(deps.appendAudit.mock.calls);
    expect(auditJson).toContain("aaaa");
    expect(auditJson).not.toContain(lineUserId);
    expect(auditJson).not.toContain(token);
  });

  it("rejects a test identity already linked to a real client", async () => {
    const deps = dependencies(profile({ lineLinkStatus: "LINK_ACTIVE", lineLinkTokenHash: hashLineConnectionToken(token), lineLinkTokenEncrypted: "encrypted", lineLinkTokenExpiresAt: "2026-08-22T00:00:00.000Z" }));
    deps.listClients.mockResolvedValue([client({ line_user_id: lineUserId })]);

    await expect(createLineMessageTestConnectionService(deps).claim({ token, lineUserId, displayName: "Test", now })).resolves.toBe("CONFLICT");
    expect(deps.claimConnection).not.toHaveBeenCalled();
    expect(deps.updateProfileIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ profile: expect.objectContaining({ lineLinkStatus: "REVIEW", lineLinkError: "LINE user conflict" }) }));
  });

  it("disconnects only test identity and clears all reusable connection state", async () => {
    const linked = profile({ lineUserId, lineDisplayName: "Test", lineLinkStatus: "LINKED", lineLinkedAt: now, lineLinkTokenHash: hashLineConnectionToken(token) });
    const deps = dependencies(linked);

    await expect(createLineMessageTestConnectionService(deps).disconnect({ now: "2026-08-16T00:00:00.000Z" })).resolves.toBe(true);
    expect(deps.disconnectConnection).toHaveBeenCalledWith({ expectedProfile: linked, profile: expect.objectContaining({ lineUserId: "", lineDisplayName: "", linePictureUrl: "", lineLinkStatus: "", lineLinkedAt: "", lineLinkTokenHash: "", lineLinkTokenEncrypted: "", lineLinkTokenExpiresAt: "" }) });
  });
});
