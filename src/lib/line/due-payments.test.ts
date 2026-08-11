import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_HEADERS } from "@/lib/sheets/records";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentRecord } from "@/lib/sheets/payments";
import { DEFAULT_LINE_DUE_TEMPLATE } from "./message-template";
import { sendDueLinePaymentRequests, type LineDueDependencies } from "./due-payments";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  const blank = Object.fromEntries(PAYMENT_HEADERS.map((header) => [header, ""])) as Record<(typeof PAYMENT_HEADERS)[number], string>;
  return {
    ...blank,
    rowNumber: 2,
    payment_id: "pay_1",
    client_id: "client_1",
    client_name: "Stale copied name",
    period: "2026-08",
    amount_thb: "1500",
    due_date: "2026-08-10",
    public_token: "token_1",
    payment_url: "https://pay.example/p/token_1",
    status: "PENDING",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    rowNumber: 2,
    client_id: "client_1",
    active: "TRUE",
    client_name: "Nisa Current",
    line_user_id: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    line_display_name: "Nisa",
    package_name: "Coaching",
    payment_type: "ONE_TIME",
    total_price_thb: "1500",
    installment_count: "1",
    interval_months: "0",
    first_due_date: "2026-08-10",
    default_amount_thb: "1500",
    billing_frequency: "MANUAL",
    next_due_date: "",
    notes: "",
    created_at: "",
    updated_at: "",
    line_link_code: "",
    line_link_code_expires_at: "",
    line_link_status: "LINKED",
    line_linked_at: "",
    line_link_message: "",
    line_link_error: "",
    ...overrides,
  };
}

function dependencies(rows: PaymentRecord[] = [payment()]): LineDueDependencies & {
  listPayments: ReturnType<typeof vi.fn>;
  updatePayment: ReturnType<typeof vi.fn>;
  appendAudit: ReturnType<typeof vi.fn>;
  sendPush: ReturnType<typeof vi.fn>;
  listClients: ReturnType<typeof vi.fn>;
  createRetryKey: ReturnType<typeof vi.fn>;
  getLineDueTemplate: ReturnType<typeof vi.fn>;
  hasAuditEvent: ReturnType<typeof vi.fn>;
  now: ReturnType<typeof vi.fn>;
} {
  return {
    listPayments: vi.fn(async () => rows),
    listClients: vi.fn(async () => [client()]),
    updatePayment: vi.fn(async () => undefined),
    appendAudit: vi.fn(async () => undefined),
    getLineDueTemplate: vi.fn(async () => "Hi {{client_name}}: {{payment_label}} {{amount}} due {{due_date}} {{payment_url}}"),
    hasAuditEvent: vi.fn(async () => false),
    getLineChannelAccessToken: vi.fn(async () => "line-token-value-1234567890"),
    sendPush: vi.fn(async () => ({ accepted: true, retryable: false, requestId: "request_1", errorCode: "" })),
    lineMessagingEnabled: vi.fn(() => true),
    createRetryKey: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
    now: vi.fn(() => "2026-08-10T02:00:00.000Z"),
  };
}

function auditIdentity(record: { paymentId: string; action: string; metadata?: string }): string {
  const metadata = JSON.parse(record.metadata ?? "{}") as { requestCode?: string };
  return `${record.paymentId}|${record.action}|${metadata.requestCode ?? ""}`;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("sendDueLinePaymentRequests", () => {
  it("delivers catch-up payments to current linked client with rendered text and HTTPS QR", async () => {
    const deps = dependencies([payment({ due_date: "2026-08-01" })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: ["pay_1"], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false });

    expect(deps.sendPush).toHaveBeenCalledWith(expect.objectContaining({
      to: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      retryKey: "11111111-1111-4111-8111-111111111111",
      messages: [
        { type: "text", text: "Hi Nisa Current: August Coaching ฿1,500.00 due 2026-08-01 https://pay.example/p/token_1" },
        { type: "image", originalContentUrl: "https://pay.example/api/payments/token_1/promptpay-qr.png", previewImageUrl: "https://pay.example/api/payments/token_1/promptpay-qr.png" },
      ],
    }));
    expect(deps.updatePayment.mock.calls[0]?.[0]).toMatchObject({ line_message_status: "SENDING", line_message_attempted_at: "2026-08-10T02:00:00.000Z", line_message: "Hi Nisa Current: August Coaching ฿1,500.00 due 2026-08-01 https://pay.example/p/token_1" });
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "ACCEPTED", line_request_id: "request_1", line_slip_expected: "TRUE", line_slip_processing_status: "AWAITING", line_message_sent_at: "2026-08-10T02:00:00.000Z", line_payment_requested_at: "2026-08-10T02:00:00.000Z" });
    expect(deps.appendAudit.mock.calls.map(([value]) => value.action)).toEqual(["LINE_DUE_MESSAGE_ACCEPTED", "LINE_PAYMENT_QR_SENT"]);
    expect(deps.appendAudit.mock.calls[0]?.[0].metadata).toBe(JSON.stringify({ paymentId: "pay_1", status: "ACCEPTED", requestCode: "request_1" }));
  });

  it("persists frozen text and retry key before the first outbound request", async () => {
    const deps = dependencies();
    deps.sendPush.mockImplementation(async () => {
      expect(deps.updatePayment.mock.calls[0]?.[0]).toMatchObject({
        payment_id: "pay_1",
        line_message_status: "SENDING",
        line_retry_key: "11111111-1111-4111-8111-111111111111",
      });
      return { accepted: true, retryable: false, requestId: "request_1", errorCode: "" };
    });

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);
  });

  it("does not trust a pre-existing legacy line message without retry evidence", async () => {
    const deps = dependencies([payment({ line_message: "stale copied legacy text", line_message_status: "" })]);

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(deps.sendPush.mock.calls[0]?.[0].messages[0]).toEqual({ type: "text", text: "Hi Nisa Current: August Coaching ฿1,500.00 due 2026-08-10 https://pay.example/p/token_1" });
  });

  it("skips payments whose canonical amount is zero satang", async () => {
    const deps = dependencies([payment({ amount_thb: "0" })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: [], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false });
    expect(deps.sendPush).not.toHaveBeenCalled();
  });

  it("renders the documented default template from current client state", async () => {
    const deps = dependencies();
    deps.getLineDueTemplate.mockResolvedValue(DEFAULT_LINE_DUE_TEMPLATE);

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(deps.sendPush.mock.calls[0]?.[0].messages[0]).toEqual({
      type: "text",
      text: `Hi Nisa Current 👋

Your August Coaching payment is due.

Amount: ฿1,500.00
Due date: 2026-08-10

Please scan the PromptPay QR below. After paying, send the bank payment slip back in this chat.

If you have trouble with the QR, use your payment page:
https://pay.example/p/token_1`,
    });
  });

  it("skips future, invalid URL/token, terminal, and accepted payment rows", async () => {
    const deps = dependencies([
      payment({ payment_id: "future", due_date: "2026-08-11" }),
      payment({ payment_id: "terminal", status: "MANUAL_CONFIRMED" }),
      payment({ payment_id: "invalid-url", payment_url: "http://pay.example/p/token_1" }),
      payment({ payment_id: "invalid-token", public_token: "" }),
      payment({ payment_id: "accepted", line_message_status: "ACCEPTED" }),
    ]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: [], alreadyAccepted: ["accepted"], skippedMissingUserId: [], failed: [], disabled: false });
    expect(deps.sendPush).not.toHaveBeenCalled();
  });

  it("marks only missing or invalid linked user IDs skipped and keeps other clients moving", async () => {
    const deps = dependencies([payment(), payment({ payment_id: "pay_2", client_id: "missing_client", rowNumber: 3 })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: ["pay_1"], alreadyAccepted: [], skippedMissingUserId: ["pay_2"], failed: [], disabled: false });
    expect(deps.updatePayment.mock.calls.find(([value]) => value.payment_id === "pay_2")?.[0]).toMatchObject({ line_message_status: "SKIPPED_MISSING_USER_ID" });
    expect(deps.appendAudit.mock.calls.find(([value]) => value.action === "LINE_DUE_MESSAGE_SKIPPED")?.[0]).toMatchObject({ metadata: JSON.stringify({ paymentId: "pay_2", status: "SKIPPED_MISSING_USER_ID", requestCode: "MISSING_USER_ID" }) });
  });

  it("requires an active currently linked direct-user ID", async () => {
    const rows = [payment({ payment_id: "inactive", client_id: "inactive" }), payment({ payment_id: "unlinked", client_id: "unlinked", rowNumber: 3 }), payment({ payment_id: "invalid", client_id: "invalid", rowNumber: 4 })];
    const deps = dependencies(rows);
    deps.listClients.mockResolvedValue([
      client({ client_id: "inactive", active: "FALSE" }),
      client({ client_id: "unlinked", line_link_status: "PENDING" }),
      client({ client_id: "invalid", line_user_id: "not-a-line-user" }),
    ]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ skippedMissingUserId: ["inactive", "unlinked", "invalid"] });
    expect(deps.sendPush).not.toHaveBeenCalled();
  });

  it("limits a manual run to requested payment IDs", async () => {
    const deps = dependencies([payment(), payment({ payment_id: "pay_2", rowNumber: 3 })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10", paymentIds: ["pay_2"] }, deps)).resolves.toMatchObject({ accepted: ["pay_2"] });
    expect(deps.sendPush).toHaveBeenCalledTimes(1);
  });

  it("catches up a previously skipped payment after its client becomes linked", async () => {
    const deps = dependencies([payment({ line_message_status: "SKIPPED_MISSING_USER_ID", line_message_error: "MISSING_USER_ID" })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"], skippedMissingUserId: [] });
    expect(deps.sendPush).toHaveBeenCalledTimes(1);
  });

  it("reuses frozen message and retry key after an ambiguous timeout even if the template changes", async () => {
    const stored = payment({ line_message_status: "FAILED_RETRYABLE", line_retry_key: "stored-key", line_message: "Frozen message", line_message_attempted_at: "2026-08-10T01:00:00.000Z" });
    const deps = dependencies([stored]);
    deps.getLineDueTemplate.mockResolvedValue("Changed {{amount}} {{due_date}} {{payment_url}}");
    deps.sendPush.mockResolvedValueOnce({ accepted: false, retryable: true, requestId: "", errorCode: "NETWORK_ERROR" }).mockResolvedValueOnce({ accepted: true, retryable: false, requestId: "request_2", errorCode: "" });

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"] });
    expect(deps.createRetryKey).not.toHaveBeenCalled();
    expect(deps.getLineDueTemplate).not.toHaveBeenCalled();
    expect(deps.sendPush).toHaveBeenCalledTimes(2);
    expect(deps.sendPush.mock.calls[0]?.[0]).toMatchObject({ retryKey: "stored-key" });
    expect(deps.sendPush.mock.calls[0]?.[0].messages[0]).toEqual({ type: "text", text: "Frozen message" });
  });

  it("preserves the first attempt clock and prior ambiguity across later HTTP failures", async () => {
    const firstAttempt = "2026-08-09T03:00:00.000Z";
    const deps = dependencies([payment({
      line_message_status: "FAILED_RETRYABLE",
      line_retry_key: "stored-key",
      line_message: "Frozen",
      line_message_attempted_at: firstAttempt,
      line_message_error: "NETWORK_ERROR",
    })]);
    deps.sendPush.mockResolvedValue({ accepted: false, retryable: true, requestId: "", errorCode: "HTTP_503" });

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({
      line_message_status: "FAILED_RETRYABLE",
      line_message_attempted_at: firstAttempt,
      line_message_error: "NETWORK_ERROR",
    });
  });

  it("keeps a same-run network ambiguity when a later retry gets HTTP 503", async () => {
    const deps = dependencies();
    deps.sendPush
      .mockResolvedValueOnce({ accepted: false, retryable: true, requestId: "", errorCode: "NETWORK_ERROR" })
      .mockResolvedValue({ accepted: false, retryable: true, requestId: "", errorCode: "HTTP_503" });

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "FAILED_RETRYABLE", line_message_error: "NETWORK_ERROR" });
  });

  it("carries persisted SENDING ambiguity across runs until the first-attempt review window", async () => {
    let stored = payment({
      line_message_status: "SENDING",
      line_retry_key: "stored-key",
      line_message: "Frozen",
      line_message_attempted_at: "2026-08-09T03:00:00.000Z",
    });
    const deps = dependencies([stored]);
    deps.listPayments.mockImplementation(async () => [stored]);
    deps.updatePayment.mockImplementation(async (next) => { stored = next; });
    deps.sendPush.mockResolvedValue({ accepted: false, retryable: true, requestId: "", errorCode: "HTTP_503" });

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(stored).toMatchObject({ line_message_status: "FAILED_RETRYABLE", line_message_attempted_at: "2026-08-09T03:00:00.000Z", line_message_error: "NETWORK_ERROR" });
    expect(deps.sendPush).toHaveBeenCalledTimes(3);

    deps.now.mockReturnValue("2026-08-10T04:00:00.000Z");
    deps.sendPush.mockClear();
    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(stored).toMatchObject({ status: "REVIEW", line_message_status: "REVIEW", line_message_error: "DELIVERY_AMBIGUOUS" });
    expect(deps.sendPush).not.toHaveBeenCalled();
  });

  it("retries a retryable push exactly three times then records a sanitized failure", async () => {
    const deps = dependencies();
    deps.sendPush.mockResolvedValue({ accepted: false, retryable: true, requestId: "", errorCode: "HTTP_503" });

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: [], alreadyAccepted: [], skippedMissingUserId: [], failed: ["pay_1"], disabled: false });
    expect(deps.sendPush).toHaveBeenCalledTimes(3);
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "FAILED_RETRYABLE", line_message_error: "HTTP_503" });
    expect(deps.appendAudit.mock.calls.at(-1)?.[0]).toMatchObject({ action: "LINE_DUE_MESSAGE_FAILED", metadata: JSON.stringify({ paymentId: "pay_1", status: "FAILED_RETRYABLE", requestCode: "HTTP_503" }) });
  });

  it("isolates an ambiguous client failure and continues with the next payment", async () => {
    const deps = dependencies([payment(), payment({ payment_id: "pay_2", rowNumber: 3 })]);
    deps.sendPush
      .mockRejectedValueOnce(new Error("remote response contained a secret"))
      .mockRejectedValueOnce(new Error("remote response contained a secret"))
      .mockRejectedValueOnce(new Error("remote response contained a secret"))
      .mockResolvedValueOnce({ accepted: true, retryable: false, requestId: "request_2", errorCode: "" });

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: ["pay_2"], alreadyAccepted: [], skippedMissingUserId: [], failed: ["pay_1"], disabled: false });
    expect(deps.updatePayment.mock.calls.find(([value]) => value.payment_id === "pay_1" && value.line_message_status === "FAILED_RETRYABLE")?.[0]).toMatchObject({ line_message_error: "NETWORK_ERROR" });
    expect(JSON.stringify(deps.updatePayment.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(deps.appendAudit.mock.calls)).not.toContain("secret");
  });

  it("does not roll back accepted transport state when audit persistence fails", async () => {
    const deps = dependencies();
    deps.appendAudit.mockRejectedValue(new Error("audit unavailable"));

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: ["pay_1"], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false });
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "ACCEPTED", line_request_id: "request_1" });
    expect(deps.updatePayment.mock.calls.some(([value]) => value.line_message_status === "FAILED_RETRYABLE")).toBe(false);
  });

  it("persists ACCEPTED with both audit markers before the first audit append", async () => {
    const deps = dependencies();
    const order: Array<{ kind: "payment"; status: string; error: string } | { kind: "audit"; action: string }> = [];
    deps.updatePayment.mockImplementation(async (next) => { order.push({ kind: "payment", status: next.line_message_status, error: next.line_message_error }); });
    deps.appendAudit.mockImplementation(async (record) => { order.push({ kind: "audit", action: record.action }); });

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    const firstAuditIndex = order.findIndex((entry) => entry.kind === "audit");
    const acceptedBeforeAudit = order.slice(0, firstAuditIndex).findLast((entry) => entry.kind === "payment" && entry.status === "ACCEPTED");
    expect(acceptedBeforeAudit).toEqual({ kind: "payment", status: "ACCEPTED", error: "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED_AND_LINE_PAYMENT_QR_SENT" });
  });

  it("persists only the accepted-message audit as pending when its append fails", async () => {
    const deps = dependencies();
    deps.appendAudit.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"], failed: [] });

    expect(deps.appendAudit.mock.calls.map(([value]) => value.action)).toEqual(["LINE_DUE_MESSAGE_ACCEPTED", "LINE_PAYMENT_QR_SENT"]);
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "ACCEPTED", line_message_error: "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED" });
  });

  it("persists only the QR-sent audit as pending when its append fails", async () => {
    const deps = dependencies();
    deps.appendAudit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"], failed: [] });

    expect(deps.appendAudit.mock.calls.map(([value]) => value.action)).toEqual(["LINE_DUE_MESSAGE_ACCEPTED", "LINE_PAYMENT_QR_SENT"]);
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "ACCEPTED", line_message_error: "AUDIT_PENDING_LINE_PAYMENT_QR_SENT" });
  });

  it("reconciles only the pending accepted audit on a later run and never resends LINE", async () => {
    const deps = dependencies([payment({
      line_message_status: "ACCEPTED",
      line_request_id: "request_1",
      line_message_error: "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED",
    })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: [], alreadyAccepted: ["pay_1"], skippedMissingUserId: [], failed: [], disabled: false });

    expect(deps.sendPush).not.toHaveBeenCalled();
    expect(deps.appendAudit).toHaveBeenCalledTimes(1);
    expect(deps.appendAudit.mock.calls[0]?.[0]).toMatchObject({ action: "LINE_DUE_MESSAGE_ACCEPTED" });
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "ACCEPTED", line_message_error: "" });
  });

  it("reconciles only the pending QR audit without duplicating the accepted audit", async () => {
    const deps = dependencies([payment({
      line_message_status: "ACCEPTED",
      line_request_id: "request_1",
      line_message_error: "AUDIT_PENDING_LINE_PAYMENT_QR_SENT",
    })]);

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(deps.sendPush).not.toHaveBeenCalled();
    expect(deps.appendAudit).toHaveBeenCalledTimes(1);
    expect(deps.appendAudit.mock.calls[0]?.[0]).toMatchObject({ action: "LINE_PAYMENT_QR_SENT" });
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "ACCEPTED", line_message_error: "" });
  });

  it("keeps a failed accepted-audit retry pending without resending or duplicating the QR audit", async () => {
    const deps = dependencies([payment({
      line_message_status: "ACCEPTED",
      line_request_id: "request_1",
      line_message_error: "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED",
    })]);
    deps.appendAudit.mockRejectedValue(new Error("audit unavailable"));

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ alreadyAccepted: ["pay_1"], accepted: [], failed: [] });

    expect(deps.sendPush).not.toHaveBeenCalled();
    expect(deps.appendAudit).toHaveBeenCalledTimes(1);
    expect(deps.appendAudit.mock.calls[0]?.[0]).toMatchObject({ action: "LINE_DUE_MESSAGE_ACCEPTED" });
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "ACCEPTED", line_message_error: "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED" });
  });

  it("recovers partial audit success when the granular marker update also fails", async () => {
    let stored = payment();
    const auditEvents = new Set<string>();
    let failAcceptedAudit = true;
    let failGranularMarker = true;
    const deps = dependencies([stored]);
    deps.listPayments.mockImplementation(async () => [stored]);
    deps.updatePayment.mockImplementation(async (next) => {
      if (failGranularMarker && next.line_message_error === "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED") {
        failGranularMarker = false;
        throw new Error("marker update failed");
      }
      stored = next;
    });
    deps.hasAuditEvent.mockImplementation(async (event) => auditEvents.has(`${event.paymentId}|${event.action}|${event.requestId}`));
    deps.appendAudit.mockImplementation(async (record) => {
      if (record.action === "LINE_DUE_MESSAGE_ACCEPTED" && failAcceptedAudit) {
        failAcceptedAudit = false;
        throw new Error("audit append failed");
      }
      auditEvents.add(auditIdentity(record));
    });

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(stored).toMatchObject({ line_message_status: "ACCEPTED", line_message_error: "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED_AND_LINE_PAYMENT_QR_SENT" });
    expect(auditEvents).toEqual(new Set(["pay_1|LINE_PAYMENT_QR_SENT|request_1"]));

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(stored).toMatchObject({ line_message_status: "ACCEPTED", line_message_error: "" });
    expect(auditEvents).toEqual(new Set(["pay_1|LINE_PAYMENT_QR_SENT|request_1", "pay_1|LINE_DUE_MESSAGE_ACCEPTED|request_1"]));
    expect(deps.appendAudit.mock.calls.map(([record]) => record.action)).toEqual(["LINE_DUE_MESSAGE_ACCEPTED", "LINE_PAYMENT_QR_SENT", "LINE_DUE_MESSAGE_ACCEPTED"]);
    expect(deps.sendPush).toHaveBeenCalledTimes(1);
  });

  it("deduplicates successful audits after marker clearing fails", async () => {
    let stored = payment();
    const auditEvents = new Set<string>();
    let failClear = true;
    const deps = dependencies([stored]);
    deps.listPayments.mockImplementation(async () => [stored]);
    deps.updatePayment.mockImplementation(async (next) => {
      if (failClear && next.line_message_status === "ACCEPTED" && next.line_message_error === "") {
        failClear = false;
        throw new Error("marker clear failed");
      }
      stored = next;
    });
    deps.hasAuditEvent.mockImplementation(async (event) => auditEvents.has(`${event.paymentId}|${event.action}|${event.requestId}`));
    deps.appendAudit.mockImplementation(async (record) => { auditEvents.add(auditIdentity(record)); });

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);
    expect(stored).toMatchObject({ line_message_status: "ACCEPTED", line_message_error: "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED_AND_LINE_PAYMENT_QR_SENT" });

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(stored).toMatchObject({ line_message_status: "ACCEPTED", line_message_error: "" });
    expect(deps.appendAudit).toHaveBeenCalledTimes(2);
    expect(auditEvents.size).toBe(2);
    expect(deps.sendPush).toHaveBeenCalledTimes(1);
  });

  it("keeps accepted audit markers pending when event lookup fails", async () => {
    const deps = dependencies([payment({
      line_message_status: "ACCEPTED",
      line_request_id: "request_1",
      line_message_error: "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED_AND_LINE_PAYMENT_QR_SENT",
    })]);
    deps.hasAuditEvent.mockRejectedValue(new Error("audit lookup failed"));

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(deps.appendAudit).not.toHaveBeenCalled();
    expect(deps.sendPush).not.toHaveBeenCalled();
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "ACCEPTED", line_message_error: "AUDIT_PENDING_LINE_DUE_MESSAGE_ACCEPTED_AND_LINE_PAYMENT_QR_SENT" });
  });

  it("isolates missing-recipient persistence failure and continues later clients", async () => {
    const deps = dependencies([payment({ payment_id: "missing", client_id: "missing" }), payment({ payment_id: "pay_2", rowNumber: 3 })]);
    deps.updatePayment.mockRejectedValueOnce(new Error("sheets unavailable"));

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: ["pay_2"], alreadyAccepted: [], skippedMissingUserId: [], failed: ["missing"], disabled: false });
    expect(deps.sendPush).toHaveBeenCalledTimes(1);
    expect(deps.appendAudit.mock.calls.find(([value]) => value.paymentId === "missing")?.[0]).toMatchObject({ action: "LINE_DUE_MESSAGE_FAILED", metadata: JSON.stringify({ paymentId: "missing", status: "FAILED_RETRYABLE", requestCode: "DELIVERY_ERROR" }) });
    expect(JSON.stringify(deps.updatePayment.mock.calls)).not.toContain("sheets unavailable");
  });

  it("isolates stale-review persistence failure and continues later clients", async () => {
    const stale = payment({ payment_id: "stale", client_id: "missing", line_message_status: "FAILED_RETRYABLE", line_retry_key: "stored-key", line_message: "Frozen", line_message_attempted_at: "2026-08-09T01:59:59.000Z", line_message_error: "NETWORK_ERROR" });
    const deps = dependencies([stale, payment({ payment_id: "pay_2", rowNumber: 3 })]);
    deps.updatePayment.mockRejectedValueOnce(new Error("sheets unavailable"));

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: ["pay_2"], alreadyAccepted: [], skippedMissingUserId: [], failed: ["stale"], disabled: false });
    expect(deps.sendPush).toHaveBeenCalledTimes(1);
  });

  it("isolates missing-recipient audit failure and continues later clients", async () => {
    const deps = dependencies([payment({ payment_id: "missing", client_id: "missing" }), payment({ payment_id: "pay_2", rowNumber: 3 })]);
    deps.appendAudit.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: ["pay_2"], alreadyAccepted: [], skippedMissingUserId: ["missing"], failed: [], disabled: false });
    expect(deps.sendPush).toHaveBeenCalledTimes(1);
  });

  it("sends 24-hour-old ambiguous deliveries to review without another LINE request", async () => {
    const deps = dependencies([payment({ line_message_status: "FAILED_RETRYABLE", line_retry_key: "stored-key", line_message: "Frozen", line_message_attempted_at: "2026-08-09T01:59:59.000Z" })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: [], alreadyAccepted: [], skippedMissingUserId: [], failed: ["pay_1"], disabled: false });
    expect(deps.sendPush).not.toHaveBeenCalled();
    expect(deps.updatePayment).toHaveBeenCalledWith(expect.objectContaining({ line_message_status: "REVIEW", line_message_error: "DELIVERY_AMBIGUOUS" }));
  });

  it("does not read credentials or payments when LINE messaging is disabled", async () => {
    const deps = dependencies();
    deps.lineMessagingEnabled.mockReturnValue(false);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example" }, deps)).resolves.toEqual({ accepted: [], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: true });
    expect(deps.listPayments).not.toHaveBeenCalled();
    expect(deps.getLineChannelAccessToken).not.toHaveBeenCalled();
  });

  it("reports an accepted row without sending it again", async () => {
    const deps = dependencies([payment({ line_message_status: "ACCEPTED", line_request_id: "request_1" })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: [], alreadyAccepted: ["pay_1"], skippedMissingUserId: [], failed: [], disabled: false });
    expect(deps.sendPush).not.toHaveBeenCalled();
    expect(deps.updatePayment).not.toHaveBeenCalled();
  });

  it("does not retry a permanently failed LINE request on a later cron run", async () => {
    const deps = dependencies([payment({ line_message_status: "FAILED", line_retry_key: "stored-key", line_message: "Frozen", line_message_error: "HTTP_400" })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: [], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false });
    expect(deps.sendPush).not.toHaveBeenCalled();
    expect(deps.updatePayment).not.toHaveBeenCalled();
  });
});
