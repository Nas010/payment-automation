import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";
import * as connectionModule from "./connection";
import { hashLineConnectionToken, recoverLineConnectionToken } from "./connection-token";
import {
  createLineConnectionService,
  generateMissingLineConnections,
  renewLineConnection,
  resolveLineConnectionScope,
  type LineConnectionDependencies,
} from "./connection";

const encryptionKey = Buffer.alloc(32, 6).toString("base64");
const now = "2026-08-10T12:00:00.000Z";
const tokenA = "A".repeat(43);
const tokenB = "B".repeat(43);
const userA = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const userB = "Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: "", line_display_name: "", line_picture_url: "", package_name: "PT", payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10", default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: now, updated_at: now,
    line_link_code: "", line_link_code_expires_at: "", line_link_status: "", line_linked_at: "", line_link_message: "", line_link_error: "",
    line_link_token_hash: "", line_link_token_encrypted: "", line_link_token_expires_at: "",
    ...overrides,
  };
}

function dependencies(rows: ClientRecord[], tokenGenerator = vi.fn(() => tokenA)): LineConnectionDependencies & {
  updateLineLinkClient: ReturnType<typeof vi.fn>;
  claimLineConnection: ReturnType<typeof vi.fn>;
  appendAudit: ReturnType<typeof vi.fn>;
  tokenGenerator: ReturnType<typeof vi.fn>;
} {
  return {
    listClients: vi.fn(async () => rows),
    updateLineLinkClient: vi.fn(async () => true),
    claimLineConnection: vi.fn(async () => "CLAIMED"),
    appendAudit: vi.fn(async () => undefined),
    tokenGenerator,
  };
}

beforeEach(() => vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey));
afterEach(() => vi.unstubAllEnvs());

describe("LINE connection issuance", () => {
  it("disconnects a LIFF-linked client and releases its LINE-user reservation", async () => {
    const disconnectLineUser = (connectionModule as unknown as { disconnectLineUser?: (dependencies: LineConnectionDependencies, input: { clientId: string; now: string }) => Promise<boolean> }).disconnectLineUser;
    expect(disconnectLineUser).toBeTypeOf("function");
    if (!disconnectLineUser) return;
    const deps = dependencies([client({ line_user_id: userA, line_display_name: "Nisa LINE", line_picture_url: "https://profile.line-scdn.net/avatar/path", line_link_status: "LINKED", line_linked_at: now })]);

    await expect(disconnectLineUser(deps, { clientId: "client_1", now })).resolves.toBe(true);
    expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({
      client: expect.objectContaining({ line_user_id: "", line_display_name: "", line_picture_url: "", line_link_status: "", line_link_token_hash: "", line_link_token_encrypted: "", line_link_token_expires_at: "" }),
      releaseLineUserId: userA,
    }));
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_LINK_DISCONNECTED", clientId: "client_1", newStatus: "" }));
  });

  it("issues secure connections only for eligible clients and never creates short codes", async () => {
    const pending = client({ client_id: "pending" });
    const linked = client({ rowNumber: 3, client_id: "linked", line_user_id: userA, line_link_status: "LINKED" });
    const inactive = client({ rowNumber: 4, client_id: "inactive", active: "FALSE" });
    const deps = dependencies([pending, linked, inactive]);

    await expect(generateMissingLineConnections(deps, { now })).resolves.toMatchObject({
      created: ["pending"], alreadyActive: [], alreadyLinked: ["linked"], skippedInactive: ["inactive"], failed: [],
    });
    expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({
      client_id: "pending",
      line_link_code: "",
      line_link_message: "",
      line_link_status: "LINK_ACTIVE",
      line_link_token_hash: hashLineConnectionToken(tokenA),
      line_link_token_expires_at: "2026-08-17T12:00:00.000Z",
    }) }));
    expect(JSON.stringify(deps.updateLineLinkClient.mock.calls)).not.toContain(tokenA);
  });

  it("keeps unexpired active connection during bulk generation", async () => {
    const deps = dependencies([client({
      line_link_status: "LINK_ACTIVE",
      line_link_token_hash: hashLineConnectionToken(tokenA),
      line_link_token_encrypted: "encrypted",
      line_link_token_expires_at: "2026-08-17T12:00:00.000Z",
    })]);

    await expect(generateMissingLineConnections(deps, { now })).resolves.toMatchObject({ alreadyActive: ["client_1"], created: [] });
    expect(deps.tokenGenerator).not.toHaveBeenCalled();
    expect(deps.updateLineLinkClient).not.toHaveBeenCalled();
  });

  it("renewal invalidates old token and stores recoverable new token", async () => {
    const current = client({
      line_link_status: "LINK_ACTIVE",
      line_link_token_hash: hashLineConnectionToken(tokenA),
      line_link_token_encrypted: "old-encrypted-token",
      line_link_token_expires_at: "2026-08-17T12:00:00.000Z",
    });
    const deps = dependencies([current], vi.fn(() => tokenB));

    await expect(renewLineConnection(deps, { clientId: "client_1", now })).resolves.toEqual({ clientId: "client_1", status: "LINK_ACTIVE" });
    const updated = deps.updateLineLinkClient.mock.calls[0]?.[0].client as ClientRecord;
    expect(updated.line_link_token_hash).toBe(hashLineConnectionToken(tokenB));
    expect(updated.line_link_token_hash).not.toBe(hashLineConnectionToken(tokenA));
    expect(recoverLineConnectionToken({ clientId: "client_1", encryptedToken: updated.line_link_token_encrypted })).toBe(tokenB);
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_CONNECTION_RENEWED", metadata: expect.not.stringContaining(tokenB) }));
  });
});

describe("LINE connection token scope", () => {
  it("resolves one active or consumed token without allowing ambiguous scope", () => {
    const active = client({ line_link_status: "LINK_ACTIVE", line_link_token_hash: hashLineConnectionToken(tokenA), line_link_token_encrypted: "encrypted", line_link_token_expires_at: "2026-08-17T12:00:00.000Z" });
    const testProfile = {
      version: 1 as const, clientName: "Test", packageName: "PT", totalPriceThb: "1000", paymentType: "ONE_TIME" as const, installmentCount: 1, intervalMonths: 0, firstDueDate: "2026-08-15",
      lineUserId: "", lineDisplayName: "", linePictureUrl: "", lineLinkStatus: "LINK_ACTIVE" as const, lineLinkedAt: "", lineLinkError: "", lineLinkTokenHash: hashLineConnectionToken(tokenA), lineLinkTokenEncrypted: "encrypted", lineLinkTokenExpiresAt: "2026-08-17T12:00:00.000Z", updatedAt: now,
    };

    expect(resolveLineConnectionScope({ token: tokenA, now, clients: [active], testProfile: null })).toBe("CLIENT");
    expect(resolveLineConnectionScope({ token: tokenA, now, clients: [], testProfile })).toBe("TEST");
    expect(resolveLineConnectionScope({ token: tokenA, now, clients: [active], testProfile })).toBe("INVALID");
    expect(resolveLineConnectionScope({ token: "forged", now, clients: [active], testProfile: null })).toBe("INVALID");
  });

  it("keeps consumed linked tokens routable for idempotent identity checks", () => {
    const consumed = client({ line_user_id: userA, line_link_status: "LINKED", line_link_token_hash: hashLineConnectionToken(tokenA), line_link_token_encrypted: "", line_link_token_expires_at: "" });
    expect(resolveLineConnectionScope({ token: tokenA, now, clients: [consumed], testProfile: null })).toBe("CLIENT");
  });
});

describe("LINE connection claims", () => {
  async function activeClient(overrides: Partial<ClientRecord> = {}): Promise<ClientRecord> {
    const deps = dependencies([client()]);
    await generateMissingLineConnections(deps, { now });
    return { ...(deps.updateLineLinkClient.mock.calls[0]?.[0].client as ClientRecord), ...overrides };
  }

  it("atomically links verified identity and consumes recoverable token", async () => {
    const target = await activeClient();
    const deps = dependencies([target]);
    const pictureUrl = "https://profile.line-scdn.net/avatar/path";

    await expect(createLineConnectionService(deps).claim({ token: tokenA, lineUserId: userA, displayName: "Nisa LINE", pictureUrl, now })).resolves.toEqual({ status: "LINKED", clientId: "client_1" });
    expect(deps.claimLineConnection).toHaveBeenCalledWith(expect.objectContaining({
      tokenHash: hashLineConnectionToken(tokenA),
      lineUserId: userA,
      client: expect.objectContaining({
        line_user_id: userA,
        line_display_name: "Nisa LINE",
        line_picture_url: pictureUrl,
        line_link_status: "LINKED",
        line_linked_at: now,
        line_link_token_hash: hashLineConnectionToken(tokenA),
        line_link_token_encrypted: "",
        line_link_token_expires_at: "",
      }),
    }));
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_LINK_LINKED", source: "LINE_CONNECT" }));
    expect(JSON.stringify(deps.appendAudit.mock.calls)).not.toContain(tokenA);
    expect(JSON.stringify(deps.appendAudit.mock.calls)).not.toContain(userA);
  });

  it("rejects malformed and expired tokens before claiming", async () => {
    const expired = await activeClient({ line_link_token_expires_at: "2026-08-10T11:59:59.999Z" });
    const deps = dependencies([expired]);
    const service = createLineConnectionService(deps);

    await expect(service.claim({ token: "forged", lineUserId: userA, displayName: "Nisa", now })).resolves.toEqual({ status: "INVALID_OR_EXPIRED" });
    await expect(service.claim({ token: tokenA, lineUserId: userA, displayName: "Nisa", now })).resolves.toEqual({ status: "INVALID_OR_EXPIRED" });
    expect(deps.claimLineConnection).not.toHaveBeenCalled();
  });

  it("refreshes trusted profile fields during same-client same-user retry", async () => {
    const target = await activeClient({ line_user_id: userA, line_link_status: "LINKED", line_link_token_encrypted: "", line_link_token_expires_at: "" });
    const deps = dependencies([target]);
    const pictureUrl = "https://profile.line-scdn.net/avatar/updated";
    const refreshTime = "2026-08-11T12:00:00.000Z";

    await expect(createLineConnectionService(deps).claim({ token: tokenA, lineUserId: userA, displayName: "Nisa Updated", pictureUrl, now: refreshTime })).resolves.toEqual({ status: "ALREADY_LINKED", clientId: "client_1" });
    expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({
      expectedClient: target,
      client: expect.objectContaining({
        line_user_id: userA,
        line_display_name: "Nisa Updated",
        line_picture_url: pictureUrl,
        line_link_status: "LINKED",
        updated_at: refreshTime,
      }),
    }));
    expect(deps.claimLineConnection).not.toHaveBeenCalled();
  });

  it("rejects an inactive client before same-user idempotency", async () => {
    const target = await activeClient({ active: "FALSE", line_user_id: userA, line_link_status: "LINKED", line_link_token_encrypted: "", line_link_token_expires_at: "" });
    const deps = dependencies([target]);

    await expect(createLineConnectionService(deps).claim({ token: tokenA, lineUserId: userA, displayName: "Nisa", now })).resolves.toEqual({ status: "CLIENT_INACTIVE" });
    expect(deps.claimLineConnection).not.toHaveBeenCalled();
  });

  it("marks review when consumed token is retried by different user", async () => {
    const target = await activeClient({ line_user_id: userA, line_link_status: "LINKED", line_link_token_encrypted: "", line_link_token_expires_at: "" });
    const deps = dependencies([target]);

    await expect(createLineConnectionService(deps).claim({ token: tokenA, lineUserId: userB, displayName: "Other", now })).resolves.toEqual({ status: "CONFLICT" });
    expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ line_link_status: "REVIEW", line_link_error: "LINE user conflict" }) }));
  });

  it("allows only one concurrent claimant for token", async () => {
    const target = await activeClient();
    const deps = dependencies([target]);
    let claimed = false;
    deps.claimLineConnection.mockImplementation(async () => {
      if (claimed) return "CONFLICT";
      claimed = true;
      return "CLAIMED";
    });
    const service = createLineConnectionService(deps);

    const results = await Promise.all([
      service.claim({ token: tokenA, lineUserId: userA, displayName: "Nisa", now }),
      service.claim({ token: tokenA, lineUserId: userB, displayName: "Other", now }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["CONFLICT", "LINKED"]);
    expect(results).toContainEqual({ status: "LINKED", clientId: "client_1" });
    expect(deps.claimLineConnection).toHaveBeenCalledTimes(2);
  });
});
