import { describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";
import { createLineLinkService, disconnectLineUser, generateMissingLineLinkCodes, renewLineLinkCode, type LineLinkDependencies } from "./linking";

const now = "2026-08-10T12:00:00.000Z";
const userA = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const userB = "Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: "", line_display_name: "", package_name: "PT", payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10", default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: now, updated_at: now,
    line_link_code: "ABCDEF0123", line_link_code_expires_at: "2026-08-17T12:00:00.000Z", line_link_status: "CODE_ACTIVE", line_linked_at: "", line_link_message: "message", line_link_error: "",
    ...overrides,
  };
}

function dependencies(rows: ClientRecord[], codeGenerator = vi.fn(() => "1234567890")): LineLinkDependencies & { updateClient: ReturnType<typeof vi.fn>; updateLineLinkClient: ReturnType<typeof vi.fn>; appendAudit: ReturnType<typeof vi.fn>; codeGenerator: ReturnType<typeof vi.fn>; claimLineLink: ReturnType<typeof vi.fn>; releaseLineUserReservation: ReturnType<typeof vi.fn> } {
  return {
    listClients: vi.fn(async () => rows), updateClient: vi.fn(async () => undefined), appendAudit: vi.fn(async () => undefined), codeGenerator,
    updateLineLinkClient: vi.fn(async () => true), claimLineLink: vi.fn(async () => "CLAIMED"), releaseLineUserReservation: vi.fn(async () => undefined),
  };
}

describe("LINE linking domain service", () => {
  it("rejects invalid or expired active codes without writing", async () => {
    const deps = dependencies([client({ line_link_code_expires_at: "2026-08-10T11:59:59.999Z" })]);
    const service = createLineLinkService(deps);

    await expect(service.linkLineUser({ code: "bad", lineUserId: userA, now, webhookEventId: "event_1" })).resolves.toBe("INVALID_OR_EXPIRED");
    await expect(service.linkLineUser({ code: "ABCDEF0123", lineUserId: userA, now, webhookEventId: "event_2" })).resolves.toBe("INVALID_OR_EXPIRED");
    expect(deps.updateClient).not.toHaveBeenCalled();
    expect(deps.appendAudit).not.toHaveBeenCalled();
  });

  it("rejects a valid code for an inactive client without writing", async () => {
    const deps = dependencies([client({ active: "FALSE" })]);

    await expect(createLineLinkService(deps).linkLineUser({ code: "ABCDEF0123", lineUserId: userA, now, webhookEventId: "event_1" })).resolves.toBe("CLIENT_INACTIVE");
    expect(deps.updateClient).not.toHaveBeenCalled();
  });

  it("links a unique active client and clears its consumed-code fields", async () => {
    const deps = dependencies([client()]);

    await expect(createLineLinkService(deps).linkLineUser({ code: "abcdef0123", lineUserId: userA, now, webhookEventId: "event_1" })).resolves.toBe("LINKED");
    expect(deps.claimLineLink).toHaveBeenCalledWith(expect.objectContaining({ code: "ABCDEF0123", lineUserId: userA, client: expect.objectContaining({ line_user_id: userA, line_link_status: "LINKED", line_linked_at: now, line_link_code: "", line_link_code_expires_at: "", line_link_message: "", line_link_error: "", updated_at: now }) }));
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client_1", action: "LINE_LINK_LINKED", newStatus: "LINKED", metadata: JSON.stringify({ clientId: "client_1", status: "LINKED", webhookEventId: "event_1", lineUserSuffix: "aaaa" }) }));
    expect(deps.appendAudit.mock.calls[0][0].metadata).not.toContain(userA);
    expect(deps.appendAudit.mock.calls[0][0].metadata).not.toContain("ABCDEF0123");
  });

  it("persists a profile display name only for the currently linked user", async () => {
    const deps = dependencies([client({ line_user_id: userA, line_link_status: "LINKED", line_link_code: "", line_link_code_expires_at: "" })]);
    const service = createLineLinkService(deps);

    await expect(service.persistLineDisplayName({ lineUserId: userA, displayName: "Nisa LINE", now })).resolves.toBe(true);
    await expect(service.persistLineDisplayName({ lineUserId: userB, displayName: "Other", now })).resolves.toBe(false);
    expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ line_user_id: userA, line_display_name: "Nisa LINE", updated_at: now }) }));
  });

  it("escapes formula-leading LINE display names before they reach Sheets", async () => {
    const deps = dependencies([client({ line_user_id: userA, line_link_status: "LINKED", line_link_code: "", line_link_code_expires_at: "" })]);
    const service = createLineLinkService(deps);

    for (const displayName of ["=HYPERLINK(\"https://example.test\")", "+name", "-name", "@name"]) {
      await expect(service.persistLineDisplayName({ lineUserId: userA, displayName, now })).resolves.toBe(true);
    }
    expect(deps.updateLineLinkClient.mock.calls.map(([input]) => input.client.line_display_name)).toEqual(["'=HYPERLINK(\"https://example.test\")", "'+name", "'-name", "'@name"]);
  });

  it("does not enrich a user mapping that is under trainer review", async () => {
    const deps = dependencies([client({ line_user_id: userA, line_link_status: "REVIEW" })]);

    await expect(createLineLinkService(deps).persistLineDisplayName({ lineUserId: userA, displayName: "Nisa LINE", now })).resolves.toBe(false);
    expect(deps.updateClient).not.toHaveBeenCalled();
  });

  it("does not resurrect a link when disconnect wins before profile persistence", async () => {
    const rows = [client({ line_user_id: userA, line_link_status: "LINKED", line_link_code: "", line_link_code_expires_at: "" })];
    const deps = dependencies(rows);
    deps.updateLineLinkClient.mockImplementation(async () => {
      rows[0] = client({ line_user_id: "", line_display_name: "", line_link_status: "", line_link_code: "", line_link_code_expires_at: "" });
      return false;
    });

    await expect(createLineLinkService(deps).persistLineDisplayName({ lineUserId: userA, displayName: "Nisa LINE", now })).resolves.toBe(false);
    expect(deps.updateLineLinkClient).toHaveBeenCalledTimes(1);
    expect(deps.updateClient).not.toHaveBeenCalled();
    expect(rows[0]?.line_user_id).toBe("");
  });

  it("treats a same-user webhook retry as idempotently already linked", async () => {
    const deps = dependencies([client({ line_user_id: userA, line_link_status: "LINKED", line_link_code: "", line_link_code_expires_at: "" })]);

    await expect(createLineLinkService(deps).linkLineUser({ code: "ABCDEF0123", lineUserId: userA, now, webhookEventId: "event_1" })).resolves.toBe("ALREADY_LINKED");
    expect(deps.updateClient).not.toHaveBeenCalled();
    expect(deps.appendAudit).not.toHaveBeenCalled();
  });

  it("marks target REVIEW when its code is used by a different user", async () => {
    const target = client({ line_user_id: userA });
    const deps = dependencies([target]);

    await expect(createLineLinkService(deps).linkLineUser({ code: "ABCDEF0123", lineUserId: userB, now, webhookEventId: "event_1" })).resolves.toBe("CONFLICT");
    expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ line_user_id: userA, line_link_status: "REVIEW", line_link_error: "LINE user conflict", updated_at: now }) }));
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_LINK_CONFLICT", newStatus: "REVIEW" }));
  });

  it("marks target REVIEW when user is already mapped to another client", async () => {
    const target = client();
    const other = client({ rowNumber: 3, client_id: "client_2", line_link_code: "", line_link_code_expires_at: "", line_link_status: "LINKED", line_user_id: userA });
    const deps = dependencies([target, other]);

    await expect(createLineLinkService(deps).linkLineUser({ code: "ABCDEF0123", lineUserId: userA, now, webhookEventId: "event_1" })).resolves.toBe("CONFLICT");
    expect(deps.updateLineLinkClient).toHaveBeenCalledTimes(1);
    expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ client_id: "client_1", line_user_id: "", line_link_status: "REVIEW", line_link_error: "LINE user conflict" }) }));
  });

  it("allows only one competing user to consume the same code", async () => {
    const deps = dependencies([client()]);
    const claimedCodes = new Set<string>();
    const claimedUsers = new Set<string>();
    deps.claimLineLink.mockImplementation(async ({ code, lineUserId }: { code: string; lineUserId: string }) => {
      if (claimedCodes.has(code) || claimedUsers.has(lineUserId)) return "CONFLICT";
      claimedCodes.add(code);
      claimedUsers.add(lineUserId);
      return "CLAIMED";
    });
    const service = createLineLinkService(deps);

    const results = await Promise.all([
      service.linkLineUser({ code: "ABCDEF0123", lineUserId: userA, now, webhookEventId: "event_a" }),
      service.linkLineUser({ code: "ABCDEF0123", lineUserId: userB, now, webhookEventId: "event_b" }),
    ]);

    expect(results.sort()).toEqual(["CONFLICT", "LINKED"]);
    expect(deps.claimLineLink).toHaveBeenCalledTimes(2);
    expect(deps.updateClient).not.toHaveBeenCalled();
  });

  it("allows only one competing code to link the same user", async () => {
    const first = client();
    const second = client({ rowNumber: 3, client_id: "client_2", line_link_code: "1234567890" });
    const deps = dependencies([first, second]);
    const claimedCodes = new Set<string>();
    const claimedUsers = new Set<string>();
    deps.claimLineLink.mockImplementation(async ({ code, lineUserId }: { code: string; lineUserId: string }) => {
      if (claimedCodes.has(code) || claimedUsers.has(lineUserId)) return "CONFLICT";
      claimedCodes.add(code);
      claimedUsers.add(lineUserId);
      return "CLAIMED";
    });
    const service = createLineLinkService(deps);

    const results = await Promise.all([
      service.linkLineUser({ code: "ABCDEF0123", lineUserId: userA, now, webhookEventId: "event_a" }),
      service.linkLineUser({ code: "1234567890", lineUserId: userA, now, webhookEventId: "event_b" }),
    ]);

    expect(results.sort()).toEqual(["CONFLICT", "LINKED"]);
    expect(deps.claimLineLink).toHaveBeenCalledTimes(2);
    expect(deps.updateClient).not.toHaveBeenCalled();
  });

  it("does not consume a code after a concurrent renewal wins its state claim", async () => {
    const deps = dependencies([client()]);
    deps.claimLineLink.mockResolvedValue("STALE");

    await expect(createLineLinkService(deps).linkLineUser({ code: "ABCDEF0123", lineUserId: userA, now, webhookEventId: "event_renewal" })).resolves.toBe("INVALID_OR_EXPIRED");
    expect(deps.appendAudit).not.toHaveBeenCalled();
  });

  it("keeps a renewed code unlinked when renewal wins an interleaved webhook claim", async () => {
    let stored = client();
    const deps = dependencies([stored]);
    const claimedStates = new Set<string>();
    const stateKey = (item: ClientRecord) => JSON.stringify([item.client_id, item.line_link_code, item.line_link_status, item.updated_at]);
    let releaseClaim: () => void = () => undefined;
    const claimGate = new Promise<void>((resolve) => { releaseClaim = resolve; });
    deps.listClients.mockImplementation(async () => [stored]);
    deps.updateLineLinkClient.mockImplementation(async ({ client: updated, expectedClient }: { client: ClientRecord; expectedClient: ClientRecord }) => {
      const key = stateKey(expectedClient);
      if (claimedStates.has(key)) return false;
      claimedStates.add(key);
      stored = updated;
      return true;
    });
    deps.claimLineLink.mockImplementation(async ({ client: linked, expectedClient }: { client: ClientRecord; expectedClient: ClientRecord }) => {
      await claimGate;
      const key = stateKey(expectedClient);
      if (claimedStates.has(key)) return "STALE";
      claimedStates.add(key);
      stored = linked;
      return "CLAIMED";
    });
    const service = createLineLinkService(deps);
    const linking = service.linkLineUser({ code: "ABCDEF0123", lineUserId: userA, now, webhookEventId: "event_interleaved" });
    await Promise.resolve();
    await Promise.resolve();
    const renewed = await renewLineLinkCode(deps, { clientId: "client_1", now });
    releaseClaim();

    await expect(linking).resolves.toBe("INVALID_OR_EXPIRED");
    expect(renewed).toMatchObject({ code: "1234567890", status: "CODE_ACTIVE" });
    expect(stored).toMatchObject({ line_user_id: "", line_link_code: "1234567890", line_link_status: "CODE_ACTIVE" });
  });
});

describe("LINE trainer link-code functions", () => {
  it("generates codes only for eligible clients and never reuses an existing code", async () => {
    const pending = client({ client_id: "client_pending", line_link_code: "", line_link_code_expires_at: "", line_link_status: "" });
    const active = client({ rowNumber: 3, client_id: "client_active" });
    const linked = client({ rowNumber: 4, client_id: "client_linked", line_link_code: "", line_link_code_expires_at: "", line_link_status: "LINKED", line_user_id: userA });
    const inactive = client({ rowNumber: 5, client_id: "client_inactive", active: "FALSE", line_link_code: "", line_link_code_expires_at: "", line_link_status: "" });
    const codeGenerator = vi.fn().mockReturnValueOnce("ABCDEF0123").mockReturnValueOnce("1234567890");
    const deps = dependencies([pending, active, linked, inactive], codeGenerator);

    const result = await generateMissingLineLinkCodes(deps, { now });

    expect(result).toMatchObject({ created: ["client_pending"], alreadyActive: ["client_active"], alreadyLinked: ["client_linked"], skippedInactive: ["client_inactive"], failed: [] });
    expect(codeGenerator).toHaveBeenCalledTimes(2);
    expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ client_id: "client_pending", line_link_code: "1234567890", line_link_code_expires_at: "2026-08-17T12:00:00.000Z", line_link_status: "CODE_ACTIVE", line_link_message: "Hi Nisa, reply with this exact message to link your LINE account:\nLINK 1234567890" }) }));
  });

  it("keeps a non-expired code even when its status needs review", async () => {
    const review = client({ line_link_status: "REVIEW", line_link_error: "LINE user conflict" });
    const deps = dependencies([review]);

    await expect(generateMissingLineLinkCodes(deps, { now })).resolves.toMatchObject({ created: [], alreadyActive: ["client_1"], failed: [] });
    expect(deps.updateClient).not.toHaveBeenCalled();
    expect(deps.codeGenerator).not.toHaveBeenCalled();
  });

  it("replaces an eligible client code with a new unique seven-day code", async () => {
    const current = client();
    const other = client({ rowNumber: 3, client_id: "client_2", line_link_code: "1234567890" });
    const deps = dependencies([current, other], vi.fn(() => "FEDCBA9876"));

    await expect(renewLineLinkCode(deps, { clientId: "client_1", now })).resolves.toMatchObject({ clientId: "client_1", code: "FEDCBA9876", status: "CODE_ACTIVE" });
    expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ line_link_code: "FEDCBA9876", line_link_code_expires_at: "2026-08-17T12:00:00.000Z", line_link_status: "CODE_ACTIVE", line_link_error: "" }) }));
  });

  it("clears mapping and link state when trainer disconnects a client", async () => {
    const deps = dependencies([client({ line_user_id: userA, line_display_name: "Nisa LINE", line_link_status: "LINKED", line_linked_at: now, line_link_code: "", line_link_code_expires_at: "", line_link_message: "" })]);

    await expect(disconnectLineUser(deps, { clientId: "client_1", now })).resolves.toBe(true);
    expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ line_user_id: "", line_display_name: "", line_link_code: "", line_link_code_expires_at: "", line_link_status: "", line_linked_at: "", line_link_message: "", line_link_error: "", updated_at: now }) }));
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_LINK_DISCONNECTED", clientId: "client_1", newStatus: "" }));
  });
});
