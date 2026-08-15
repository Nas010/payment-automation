import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runtimeConfig: vi.fn(),
  verifyLineIdToken: vi.fn(),
  allow: vi.fn(),
  claim: vi.fn(),
  listClients: vi.fn(),
  updateLineLinkClient: vi.fn(),
  claimLineConnection: vi.fn(),
  appendAudit: vi.fn(),
  deliverAfterConnection: vi.fn(),
}));

vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("@/lib/line/liff-verification", () => ({
  LineIdTokenVerificationError: class LineIdTokenVerificationError extends Error {
    constructor(public readonly code: "INVALID" | "TEMPORARY") { super("LINE ID token verification failed"); }
  },
  verifyLineIdToken: mocks.verifyLineIdToken,
}));
vi.mock("@/lib/security/rate-limit", () => ({ lineConnectionLimiter: { allow: mocks.allow } }));
vi.mock("@/lib/line/connection", () => ({ createLineConnectionService: () => ({ claim: mocks.claim }) }));
vi.mock("@/lib/line/post-connection-delivery", () => ({
  deliverDueInitialPaymentsAfterLineConnection: mocks.deliverAfterConnection,
}));
vi.mock("@/lib/sheets/clients", () => ({ listClients: mocks.listClients, updateLineLinkClient: mocks.updateLineLinkClient, claimLineConnection: mocks.claimLineConnection }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit }));

import { LineIdTokenVerificationError } from "@/lib/line/liff-verification";
import { POST, runtime } from "./route";

const idToken = "raw.id.token";
const connectionToken = "A".repeat(43);
const lineUserId = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function request(body: unknown): Request {
  return new Request("https://pay.example/api/line/connect", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtimeConfig.mockResolvedValue({ lineLinkingEnabled: true, lineLoginChannelId: "1234567890" });
  mocks.verifyLineIdToken.mockResolvedValue({ lineUserId, displayName: "Nisa LINE", pictureUrl: "https://profile.line-scdn.net/avatar/path" });
  mocks.allow.mockReturnValue(true);
  mocks.claim.mockResolvedValue({ status: "LINKED", clientId: "client_1" });
  mocks.deliverAfterConnection.mockResolvedValue(undefined);
});

describe("POST /api/line/connect", () => {
  it("runs in Node, verifies server-side, and atomically claims using only raw ID token plus connection token", async () => {
    expect(runtime).toBe("nodejs");
    const response = await POST(request({ idToken, connectionToken }));
    const rawResponse = await response.clone().text();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "success" });
    expect(mocks.verifyLineIdToken).toHaveBeenCalledWith(expect.objectContaining({ idToken, channelId: "1234567890", fetchFn: fetch }));
    expect(mocks.claim).toHaveBeenCalledWith({ token: connectionToken, lineUserId, displayName: "Nisa LINE", pictureUrl: "https://profile.line-scdn.net/avatar/path", now: expect.any(Date) });
    expect(mocks.deliverAfterConnection).toHaveBeenCalledWith({ clientId: "client_1" });
    expect(rawResponse).not.toContain(idToken);
    expect(rawResponse).not.toContain(connectionToken);
    expect(rawResponse).not.toContain(lineUserId);
    expect(rawResponse).not.toContain("client_1");
    expect(rawResponse).not.toContain("pay_due");
    expect(rawResponse).not.toContain("https://pay.example/p/payment-token");
    expect(rawResponse).not.toContain("delivery failed");
  });

  it("rejects malformed or extra client-supplied identity data before verification", async () => {
    for (const body of [null, {}, { idToken: "", connectionToken }, { idToken, connectionToken: "short" }, { idToken, connectionToken, lineUserId }]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ status: "invalid" });
    }
    expect(mocks.verifyLineIdToken).not.toHaveBeenCalled();
  });

  it("hides disabled or unconfigured linking and rate-limits before calling LINE", async () => {
    mocks.runtimeConfig.mockResolvedValueOnce({ lineLinkingEnabled: false, lineLoginChannelId: "" });
    await expect(POST(request({ idToken, connectionToken }))).resolves.toMatchObject({ status: 404 });

    mocks.runtimeConfig.mockResolvedValueOnce({ lineLinkingEnabled: true, lineLoginChannelId: "" });
    await expect(POST(request({ idToken, connectionToken }))).resolves.toMatchObject({ status: 503 });

    mocks.allow.mockReturnValueOnce(false);
    const limited = await POST(request({ idToken, connectionToken }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ status: "temporary_failure" });
  });

  it("maps invalid verification separately from temporary LINE failure", async () => {
    mocks.verifyLineIdToken.mockRejectedValueOnce(new LineIdTokenVerificationError("INVALID"));
    const invalid = await POST(request({ idToken, connectionToken }));
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toEqual({ status: "invalid" });

    mocks.verifyLineIdToken.mockRejectedValueOnce(new LineIdTokenVerificationError("TEMPORARY"));
    const temporary = await POST(request({ idToken, connectionToken }));
    expect(temporary.status).toBe(503);
    expect(await temporary.json()).toEqual({ status: "temporary_failure" });
  });

  it("recovers delivery after an idempotent already-linked claim", async () => {
    mocks.claim.mockResolvedValueOnce({ status: "ALREADY_LINKED", clientId: "client_1" });

    const response = await POST(request({ idToken, connectionToken }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "already_used" });
    expect(mocks.deliverAfterConnection).toHaveBeenCalledWith({ clientId: "client_1" });
  });

  it("awaits post-connection delivery before returning the successful connection response", async () => {
    let releaseDelivery = () => {};
    mocks.deliverAfterConnection.mockImplementation(() => new Promise<void>((resolve) => { releaseDelivery = resolve; }));
    const responsePromise = POST(request({ idToken, connectionToken }));

    await vi.waitFor(() => expect(mocks.deliverAfterConnection).toHaveBeenCalledWith({ clientId: "client_1" }));
    let responseResolved = false;
    void responsePromise.then(() => { responseResolved = true; });
    await Promise.resolve();
    expect(responseResolved).toBe(false);

    releaseDelivery();
    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
  });

  it("preserves a successful connection response when post-connection delivery fails", async () => {
    mocks.deliverAfterConnection.mockRejectedValueOnce(new Error("delivery failed"));

    const response = await POST(request({ idToken, connectionToken }));
    const rawResponse = await response.clone().text();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "success" });
    expect(rawResponse).not.toContain("delivery failed");
    expect(rawResponse).not.toContain("client_1");
  });

  it.each([
    [{ status: "INVALID_OR_EXPIRED" }, 410, "expired"],
    [{ status: "CLIENT_INACTIVE" }, 410, "expired"],
    [{ status: "CONFLICT" }, 409, "conflict"],
  ])("maps unsuccessful claim safely without delivering payments", async (claim, status, responseStatus) => {
    mocks.claim.mockResolvedValueOnce(claim);
    const response = await POST(request({ idToken, connectionToken }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ status: responseStatus });
    expect(mocks.deliverAfterConnection).not.toHaveBeenCalled();
  });
});
