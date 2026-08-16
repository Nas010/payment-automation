import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";

const mocks = vi.hoisted(() => ({
  getLineChannelSecret: vi.fn(),
  getLineChannelAccessToken: vi.fn(),
  listClients: vi.fn(),
  updateClient: vi.fn(),
  updateLineLinkClient: vi.fn(),
  claimLineLink: vi.fn(),
  appendAudit: vi.fn(),
  processLineSlipEvent: vi.fn(),
  fetchFn: vi.fn(),
  runtimeConfig: vi.fn(),
}));

vi.mock("@/lib/secrets/service", () => ({
  getLineChannelSecret: mocks.getLineChannelSecret,
  getLineChannelAccessToken: mocks.getLineChannelAccessToken,
}));

vi.mock("@/lib/sheets/clients", () => ({
  listClients: mocks.listClients,
  updateClient: mocks.updateClient,
  updateLineLinkClient: mocks.updateLineLinkClient,
  claimLineLink: mocks.claimLineLink,
}));

vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit }));

vi.mock("@/lib/line/slip-payments", () => ({ processLineSlipEvent: mocks.processLineSlipEvent }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));

vi.stubGlobal("fetch", mocks.fetchFn);

import { POST, runtime } from "./route";

const secret = "12345678901234567890123456789012";
const accessToken = "access-token-which-is-never-logged";
const userId = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const now = "2026-08-10T12:00:00.000Z";

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: "", line_display_name: "", line_picture_url: "", package_name: "PT", payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10", default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: now, updated_at: now,
    line_link_code: "ABCDEF0123", line_link_code_expires_at: "2099-08-17T12:00:00.000Z", line_link_status: "CODE_ACTIVE", line_linked_at: "", line_link_message: "message", line_link_error: "",
    ...overrides,
  };
}

function signedRequest(body: unknown, signature = true): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers = new Headers();
  if (signature) headers.set("x-line-signature", createHmac("sha256", secret).update(raw).digest("base64"));
  return new Request("https://example.test/api/line/webhook", { method: "POST", headers, body: raw });
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "message", webhookEventId: "event_1", replyToken: "reply-token", source: { type: "user", userId }, message: { type: "text", text: "LINK ABCDEF0123" }, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.runtimeConfig.mockResolvedValue({ lineLinkingEnabled: true });
  mocks.getLineChannelSecret.mockResolvedValue(secret);
  mocks.getLineChannelAccessToken.mockResolvedValue(accessToken);
  mocks.listClients.mockResolvedValue([client()]);
  mocks.updateClient.mockResolvedValue(undefined);
  mocks.updateLineLinkClient.mockResolvedValue(true);
  mocks.claimLineLink.mockResolvedValue("CLAIMED");
  mocks.appendAudit.mockResolvedValue(undefined);
  mocks.processLineSlipEvent.mockResolvedValue({ kind: "ignored" });
  mocks.fetchFn.mockResolvedValue(new Response(null, { status: 200 }));
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/line/webhook", () => {
  it("runs in Node runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("returns 404 without reading or processing a webhook when LINE linking is disabled", async () => {
    mocks.runtimeConfig.mockResolvedValue({ lineLinkingEnabled: false });
    const request = signedRequest({ events: [event()] });
    const text = vi.spyOn(request, "text");

    await expect(POST(request)).resolves.toMatchObject({ status: 404 });
    expect(text).not.toHaveBeenCalled();
    expect(mocks.getLineChannelSecret).not.toHaveBeenCalled();
    expect(mocks.listClients).not.toHaveBeenCalled();
    expect(mocks.fetchFn).not.toHaveBeenCalled();
  });

  it("rejects missing or invalid signatures before parsing JSON", async () => {
    const parse = vi.spyOn(JSON, "parse");
    const invalidSignature = signedRequest({ events: [] });
    invalidSignature.headers.set("x-line-signature", `${"A".repeat(43)}=`);

    await expect(POST(signedRequest("not json", false))).resolves.toMatchObject({ status: 401 });
    await expect(POST(invalidSignature)).resolves.toMatchObject({ status: 401 });
    await expect(POST(signedRequest("not json", true))).resolves.toMatchObject({ status: 400 });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(mocks.listClients).not.toHaveBeenCalled();
  });

  it("acknowledges a signed empty event list without resolving access credentials", async () => {
    await expect(POST(signedRequest({ events: [] }))).resolves.toMatchObject({ status: 200 });
    expect(mocks.getLineChannelSecret).toHaveBeenCalledTimes(1);
    expect(mocks.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(mocks.fetchFn).not.toHaveBeenCalled();
  });

  it("ignores group, room, and malformed-user messages", async () => {
    const events = [
      event({ source: { type: "group", userId } }),
      event({ source: { type: "room", userId } }),
      event({ source: { type: "user", userId: "UABC" } }),
    ];

    await expect(POST(signedRequest({ events }))).resolves.toMatchObject({ status: 200 });
    expect(mocks.listClients).not.toHaveBeenCalled();
    expect(mocks.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(mocks.fetchFn).not.toHaveBeenCalled();
  });

  it("routes a valid signed direct-user image to the eligible slip processor", async () => {
    const image = event({ message: { type: "image", id: "message_1" } });

    await expect(POST(signedRequest({ events: [image] }))).resolves.toMatchObject({ status: 200 });

    expect(mocks.processLineSlipEvent).toHaveBeenCalledWith({ webhookEventId: "event_1", replyToken: "reply-token", lineUserId: userId, messageId: "message_1" });
  });

  it("isolates a failed image event and acknowledges later signed events", async () => {
    mocks.processLineSlipEvent.mockRejectedValueOnce(new Error("private processor failure"));
    const image = event({ message: { type: "image", id: "message_1" } });

    await expect(POST(signedRequest({ events: [image, event({ webhookEventId: "event_2", message: { type: "image", id: "message_2" } })] }))).resolves.toMatchObject({ status: 200 });
    expect(mocks.processLineSlipEvent).toHaveBeenCalledTimes(2);
  });

  it("refreshes a linked profile from a follow event", async () => {
    mocks.fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ displayName: "Nisa LINE", pictureUrl: "https://profile.line-scdn.net/follow-avatar" }), { status: 200 }));
    mocks.listClients.mockResolvedValue([client({ line_user_id: userId, line_link_status: "LINKED" })]);

    await expect(POST(signedRequest({ events: [event({ type: "follow" })] }))).resolves.toMatchObject({ status: 200 });
    expect(mocks.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ line_display_name: "Nisa LINE", line_picture_url: "https://profile.line-scdn.net/follow-avatar" }) }));
  });

  it("does not run a legacy direct-message connection flow", async () => {
    await expect(POST(signedRequest({ events: [event({ message: { type: "text", text: "hello" } })] }))).resolves.toMatchObject({ status: 200 });
    expect(mocks.updateLineLinkClient).not.toHaveBeenCalled();
    expect(mocks.fetchFn).not.toHaveBeenCalled();
  });

  it("acknowledges legacy LINK messages without linking or replying", async () => {
    await expect(POST(signedRequest({ events: [event()] }))).resolves.toMatchObject({ status: 200 });
    expect(mocks.claimLineLink).not.toHaveBeenCalled();
    expect(mocks.updateLineLinkClient).not.toHaveBeenCalled();
    expect(mocks.fetchFn).not.toHaveBeenCalled();
  });


});
