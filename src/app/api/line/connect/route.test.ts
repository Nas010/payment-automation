import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runtimeConfig: vi.fn(), verifyLineIdToken: vi.fn(), allow: vi.fn(), claim: vi.fn(), testClaim: vi.fn(),
  listClients: vi.fn(), updateLineLinkClient: vi.fn(), claimLineConnection: vi.fn(), appendAudit: vi.fn(),
  resolveScope: vi.fn(), getTestProfile: vi.fn(), updateTestProfile: vi.fn(), claimTestConnection: vi.fn(), disconnectTestConnection: vi.fn(),
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
vi.mock("@/lib/line/connection", () => ({ createLineConnectionService: () => ({ claim: mocks.claim }), resolveLineConnectionScope: mocks.resolveScope }));
vi.mock("@/lib/line/message-test-connection", () => ({ createLineMessageTestConnectionService: () => ({ claim: mocks.testClaim }) }));
vi.mock("@/lib/line/post-connection-delivery", () => ({ deliverDueInitialPaymentsAfterLineConnection: mocks.deliverAfterConnection }));
vi.mock("@/lib/sheets/line-message-test-profile", () => ({
  getLineMessageTestProfile: mocks.getTestProfile,
  updateLineMessageTestProfileIfUnchanged: mocks.updateTestProfile,
  claimLineMessageTestConnection: mocks.claimTestConnection,
  disconnectLineMessageTestConnection: mocks.disconnectTestConnection,
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
  mocks.testClaim.mockResolvedValue("LINKED");
  mocks.resolveScope.mockReturnValue("CLIENT");
  mocks.getTestProfile.mockResolvedValue(null);
  mocks.deliverAfterConnection.mockResolvedValue(undefined);
});

describe("POST /api/line/connect", () => {
  it("runs in Node, verifies server-side, claims a client, and starts post-connection delivery", async () => {
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
  });

  it("rejects malformed data before verification and hides disabled linking", async () => {
    for (const body of [null, {}, { idToken: "", connectionToken }, { idToken, connectionToken: "short" }, { idToken, connectionToken, lineUserId }]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.verifyLineIdToken).not.toHaveBeenCalled();

    mocks.runtimeConfig.mockResolvedValueOnce({ lineLinkingEnabled: false, lineLoginChannelId: "" });
    await expect(POST(request({ idToken, connectionToken }))).resolves.toMatchObject({ status: 404 });
  });

  it("maps invalid verification separately from temporary failure", async () => {
    mocks.verifyLineIdToken.mockRejectedValueOnce(new LineIdTokenVerificationError("INVALID"));
    await expect(POST(request({ idToken, connectionToken }))).resolves.toMatchObject({ status: 401 });
    mocks.verifyLineIdToken.mockRejectedValueOnce(new LineIdTokenVerificationError("TEMPORARY"));
    await expect(POST(request({ idToken, connectionToken }))).resolves.toMatchObject({ status: 503 });
  });

  it("rejects an unresolved token before LINE verification", async () => {
    mocks.resolveScope.mockReturnValueOnce("INVALID");
    const response = await POST(request({ idToken, connectionToken }));
    expect(response.status).toBe(410);
    expect(mocks.verifyLineIdToken).not.toHaveBeenCalled();
  });

  it("routes test-scoped tokens through same LIFF endpoint without client delivery", async () => {
    mocks.resolveScope.mockReturnValueOnce("TEST");
    const response = await POST(request({ idToken, connectionToken }));
    expect(response.status).toBe(200);
    expect(mocks.testClaim).toHaveBeenCalledWith({ token: connectionToken, lineUserId, displayName: "Nisa LINE", pictureUrl: "https://profile.line-scdn.net/avatar/path", now: expect.any(Date) });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.deliverAfterConnection).not.toHaveBeenCalled();
  });

  it("recovers client delivery after idempotent linking and protects the response when delivery fails", async () => {
    mocks.claim.mockResolvedValueOnce({ status: "ALREADY_LINKED", clientId: "client_1" });
    await expect(POST(request({ idToken, connectionToken }))).resolves.toMatchObject({ status: 200 });
    expect(mocks.deliverAfterConnection).toHaveBeenCalledWith({ clientId: "client_1" });

    mocks.deliverAfterConnection.mockRejectedValueOnce(new Error("delivery failed"));
    const response = await POST(request({ idToken, connectionToken }));
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.not.toContain("delivery failed");
  });

  it.each([
    [{ status: "INVALID_OR_EXPIRED" }, 410, "expired"],
    [{ status: "CLIENT_INACTIVE" }, 410, "expired"],
    [{ status: "CONFLICT" }, 409, "conflict"],
  ])("maps unsuccessful client claims safely", async (claim, status, responseStatus) => {
    mocks.claim.mockResolvedValueOnce(claim);
    const response = await POST(request({ idToken, connectionToken }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ status: responseStatus });
    expect(mocks.deliverAfterConnection).not.toHaveBeenCalled();
  });
});
