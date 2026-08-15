import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_HEADERS, SCHEDULE_HEADERS } from "@/lib/sheets/records";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";
import { DEFAULT_LINE_DUE_PROFILES, LineDueTemplateError, type LineDueMessageProfiles, type ResolvedLineDueMessageProfiles } from "./message-profile";
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
    package_name: "Coaching",
    payment_type: "ONE_TIME",
    installment_number: "1",
    installment_count: "1",
    total_price_thb: "1500",
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
    line_picture_url: "",
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

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  const blank = Object.fromEntries(SCHEDULE_HEADERS.map((header) => [header, ""])) as Record<(typeof SCHEDULE_HEADERS)[number], string>;
  return {
    ...blank,
    rowNumber: 2,
    schedule_id: "schedule_1",
    client_id: "client_1",
    package_name: "Coaching",
    payment_type: "ONE_TIME",
    installment_number: "1",
    installment_count: "1",
    amount_thb: "1500",
    due_date: "2026-08-10",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } as ScheduleRecord;
}

function resolvedProfiles(profiles: LineDueMessageProfiles = DEFAULT_LINE_DUE_PROFILES): ResolvedLineDueMessageProfiles {
  return {
    ONE_TIME: { kind: "VALID", profile: profiles.ONE_TIME },
    INSTALLMENTS: { kind: "VALID", profile: profiles.INSTALLMENTS },
  };
}

const termsPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const termsVersion = {
  versionId: "terms_11111111111111111111111111111111",
  publicToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  driveFileId: "terms-file-12345",
  mimeType: "image/png" as const,
  byteLength: termsPng.byteLength,
  originalName: "terms.png",
  uploadedAt: "2026-08-15T01:00:00.000Z",
};

function dependencies(rows: PaymentRecord[] = [payment()]): LineDueDependencies & {
  listPayments: ReturnType<typeof vi.fn>;
  updatePayment: ReturnType<typeof vi.fn>;
  appendAudit: ReturnType<typeof vi.fn>;
  sendPush: ReturnType<typeof vi.fn>;
  listClients: ReturnType<typeof vi.fn>;
  createRetryKey: ReturnType<typeof vi.fn>;
  getLineDueMessageProfiles: ReturnType<typeof vi.fn>;
  getLineTermsImageState: ReturnType<typeof vi.fn>;
  readDriveTermsImageFile: ReturnType<typeof vi.fn>;
  listSchedules: ReturnType<typeof vi.fn>;
  hasAuditEvent: ReturnType<typeof vi.fn>;
  now: ReturnType<typeof vi.fn>;
} {
  return {
    listPayments: vi.fn(async () => rows),
    listClients: vi.fn(async () => [client()]),
    updatePayment: vi.fn(async () => undefined),
    appendAudit: vi.fn(async () => undefined),
    getLineDueMessageProfiles: vi.fn(async () => resolvedProfiles()),
    getLineTermsImageState: vi.fn(async () => ({ activeVersionId: termsVersion.versionId, versions: [termsVersion] })),
    readDriveTermsImageFile: vi.fn(async () => ({ bytes: termsPng, declaredMimeType: "image/png" })),
    listSchedules: vi.fn(async () => []),
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
  it("uses one payment-client snapshot when the dependency is available", async () => {
    const deps = dependencies();
    const readPaymentClientSnapshot = vi.fn(async () => ({ payments: [payment()], clients: [client()], schedules: [] }));

    await sendDueLinePaymentRequests(
      { baseUrl: "https://pay.example", today: "2026-08-10" },
      { ...deps, readPaymentClientSnapshot },
    );

    expect(readPaymentClientSnapshot).toHaveBeenCalledOnce();
    expect(deps.listPayments).not.toHaveBeenCalled();
    expect(deps.listClients).not.toHaveBeenCalled();
  });

  it("delivers catch-up payments to current linked client with rendered text and HTTPS QR", async () => {
    const deps = dependencies([payment({ due_date: "2026-08-01" })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: ["pay_1"], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false });

    expect(deps.sendPush).toHaveBeenCalledWith(expect.objectContaining({
      to: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      retryKey: "11111111-1111-4111-8111-111111111111",
      messages: [
        { type: "text", text: `Hi Nisa Current 👋

Your Coaching payment is due.

Amount: ฿1,500.00
Due date: 2026-08-01

Please scan the PromptPay QR below. After paying, send the bank payment slip back in this chat.

If you have trouble with the QR, use your payment page:
https://pay.example/p/token_1` },
        { type: "image", originalContentUrl: "https://pay.example/api/payments/token_1/promptpay-qr.png", previewImageUrl: "https://pay.example/api/payments/token_1/promptpay-qr.png" },
        { type: "image", originalContentUrl: `https://pay.example/api/line/terms-image/${termsVersion.publicToken}`, previewImageUrl: `https://pay.example/api/line/terms-image/${termsVersion.publicToken}` },
      ],
    }));
    expect(deps.updatePayment.mock.calls[0]?.[0]).toMatchObject({ line_message_status: "SENDING", line_message_attempted_at: "2026-08-10T02:00:00.000Z", line_message: expect.stringContaining("Your Coaching payment is due.") });
    expect(deps.updatePayment.mock.calls[0]?.[0]).toMatchObject({ line_terms_image_token: termsVersion.publicToken });
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "ACCEPTED", line_request_id: "request_1", line_slip_expected: "TRUE", line_slip_processing_status: "AWAITING", line_message_sent_at: "2026-08-10T02:00:00.000Z", line_payment_requested_at: "2026-08-10T02:00:00.000Z" });
    expect(deps.appendAudit.mock.calls.map(([value]) => value.action)).toEqual(["LINE_DUE_MESSAGE_ACCEPTED", "LINE_PAYMENT_QR_SENT"]);
    expect(deps.appendAudit.mock.calls[0]?.[0].metadata).toBe(JSON.stringify({ paymentId: "pay_1", status: "ACCEPTED", requestCode: "request_1" }));
  });

  it("uses each extension plan's installment one and skips later installments", async () => {
    const deps = dependencies([
      payment({ payment_id: "pay_extension_1", payment_type: "INSTALLMENTS", installment_number: "1", installment_count: "2" }),
      payment({ payment_id: "pay_extension_2", rowNumber: 3, payment_type: "INSTALLMENTS", installment_number: "2", installment_count: "2" }),
    ]);

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(deps.sendPush.mock.calls[0]?.[0].messages).toHaveLength(3);
    expect(deps.sendPush.mock.calls[1]?.[0].messages).toHaveLength(2);
    expect(deps.getLineTermsImageState).toHaveBeenCalledTimes(1);
  });

  it("falls back to text and QR and freezes NONE when active image is unavailable", async () => {
    const deps = dependencies([payment({ installment_number: "1" })]);
    deps.readDriveTermsImageFile.mockRejectedValue(new Error("private Google body"));

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"] });
    expect(deps.sendPush.mock.calls[0]?.[0].messages).toHaveLength(2);
    expect(deps.updatePayment.mock.calls[0]?.[0]).toMatchObject({ line_terms_image_token: "NONE" });
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_TERMS_IMAGE_SKIPPED", metadata: JSON.stringify({ paymentId: "pay_1", reasonCode: "ASSET_UNAVAILABLE" }) }));
    expect(JSON.stringify(deps.appendAudit.mock.calls)).not.toContain("terms-file-12345");
  });

  it("reuses frozen historical token without selecting the current active image", async () => {
    const deps = dependencies([payment({ line_message_status: "FAILED_RETRYABLE", line_retry_key: "stored-key", line_message: "Frozen message", line_terms_image_token: termsVersion.publicToken })]);
    deps.getLineTermsImageState.mockResolvedValue({ activeVersionId: "terms_new", versions: [] });

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(deps.getLineTermsImageState).not.toHaveBeenCalled();
    expect(deps.readDriveTermsImageFile).not.toHaveBeenCalled();
    expect(deps.sendPush.mock.calls[0]?.[0].messages[2]).toMatchObject({ originalContentUrl: expect.stringContaining(termsVersion.publicToken) });
  });

  it("falls back to text and QR when a frozen token is malformed", async () => {
    const deps = dependencies([payment({ line_message_status: "FAILED_RETRYABLE", line_retry_key: "stored-key", line_message: "Frozen message", line_terms_image_token: "not a token" })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"] });

    expect(deps.sendPush.mock.calls[0]?.[0].messages).toHaveLength(2);
    expect(deps.updatePayment.mock.calls[0]?.[0]).toMatchObject({ line_terms_image_token: "NONE" });
    expect(deps.getLineTermsImageState).not.toHaveBeenCalled();
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

    expect(deps.sendPush.mock.calls[0]?.[0].messages[0]).toEqual({ type: "text", text: expect.stringContaining("Your Coaching payment is due.") });
  });

  it("skips payments whose canonical amount is zero satang", async () => {
    const deps = dependencies([payment({ amount_thb: "0" })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toEqual({ accepted: [], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false });
    expect(deps.sendPush).not.toHaveBeenCalled();
  });

  it("renders the documented default template from current client state", async () => {
    const deps = dependencies();
    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(deps.sendPush.mock.calls[0]?.[0].messages[0]).toEqual({
      type: "text",
      text: `Hi Nisa Current 👋

Your Coaching payment is due.

Amount: ฿1,500.00
Due date: 2026-08-10

Please scan the PromptPay QR below. After paying, send the bank payment slip back in this chat.

If you have trouble with the QR, use your payment page:
https://pay.example/p/token_1`,
    });
  });

  it("selects installment profile and loads both profiles once for multiple payments", async () => {
    const deps = dependencies([
      payment({ payment_id: "pay_1", payment_type: "INSTALLMENTS", package_name: "PT", installment_number: "1", installment_count: "2", total_price_thb: "3000" }),
      payment({ payment_id: "pay_2", rowNumber: 3, payment_type: "INSTALLMENTS", package_name: "PT", installment_number: "2", installment_count: "2", total_price_thb: "3000" }),
    ]);

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);

    expect(deps.getLineDueMessageProfiles).toHaveBeenCalledOnce();
    expect(deps.sendPush.mock.calls[1]?.[0].messages[0].text).toContain("2nd payment out of 2");
  });

  it("records TEMPLATE_INVALID and sends nothing for corrupt stored profiles", async () => {
    const deps = dependencies();
    deps.getLineDueMessageProfiles.mockRejectedValue(new LineDueTemplateError("TEMPLATE_INVALID", "Stored LINE profile is invalid JSON"));

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ failed: ["pay_1"] });

    expect(deps.sendPush).not.toHaveBeenCalled();
    expect(deps.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "FAILED_RETRYABLE", line_message_error: "TEMPLATE_INVALID", line_message: "", line_retry_key: "" });
  });

  it("keeps valid one-time delivery operating when only installments profile is corrupt", async () => {
    const deps = dependencies([
      payment({ payment_id: "one-time", payment_type: "ONE_TIME" }),
      payment({ payment_id: "installments", rowNumber: 3, payment_type: "INSTALLMENTS", package_name: "PT", installment_number: "1", installment_count: "2", total_price_thb: "3000" }),
    ]);
    deps.getLineDueMessageProfiles.mockResolvedValue({
      ONE_TIME: { kind: "VALID", profile: DEFAULT_LINE_DUE_PROFILES.ONE_TIME },
      INSTALLMENTS: { kind: "INVALID" },
    });

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["one-time"], failed: ["installments"] });
    expect(deps.sendPush).toHaveBeenCalledOnce();
    expect(deps.updatePayment.mock.calls.find(([value]) => value.payment_id === "installments" && value.line_message_error === "TEMPLATE_INVALID")).toBeTruthy();
  });

  it.each([
    ["a lone message", { line_message: "Stale message", line_retry_key: "" }],
    ["a lone retry key", { line_message: "", line_retry_key: "stale-key" }],
    ["an untrusted message and retry-key pair", { line_message: "Stale message", line_retry_key: "stale-key" }],
  ])("clears %s after a template failure before a later send", async (_label, staleFields) => {
    let stored = payment({ ...staleFields, line_message_status: "PENDING" });
    const deps = dependencies([stored]);
    deps.listPayments.mockImplementation(async () => [stored]);
    deps.updatePayment.mockImplementation(async (next) => { stored = next; });
    deps.getLineDueMessageProfiles.mockRejectedValueOnce(new LineDueTemplateError("TEMPLATE_INVALID", "Stored LINE profile is invalid JSON"));

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ failed: ["pay_1"] });

    expect(stored).toMatchObject({ line_message_status: "FAILED_RETRYABLE", line_message_error: "TEMPLATE_INVALID", line_message: "", line_retry_key: "" });
    expect(deps.sendPush).not.toHaveBeenCalled();

    deps.getLineDueMessageProfiles.mockResolvedValue(resolvedProfiles());
    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"] });

    expect(deps.sendPush).toHaveBeenCalledOnce();
    expect(deps.sendPush.mock.calls[0]?.[0].retryKey).toBe("11111111-1111-4111-8111-111111111111");
    expect(deps.sendPush.mock.calls[0]?.[0].messages[0]).toEqual(expect.objectContaining({ type: "text", text: expect.not.stringContaining("Stale message") }));
  });

  it("records TEMPLATE_DATA_MISSING and sends nothing when legacy plan data cannot be resolved", async () => {
    const deps = dependencies([payment({ payment_type: "ONE_TIME", package_name: "", total_price_thb: "" })]);
    deps.getLineDueMessageProfiles.mockResolvedValue(resolvedProfiles({
      ONE_TIME: { version: 1, message: "{{total_amount}} {{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [] },
      INSTALLMENTS: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS,
    }));

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ failed: ["pay_1"] });

    expect(deps.sendPush).not.toHaveBeenCalled();
    expect(deps.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "FAILED_RETRYABLE", line_message_error: "TEMPLATE_DATA_MISSING", line_message: "", line_retry_key: "" });
  });

  it("sends a legacy payment with an incomplete total when its selected profile does not reference total_amount", async () => {
    const deps = dependencies([payment({ payment_type: "", package_name: "", installment_number: "", installment_count: "", total_price_thb: "" })]);
    deps.listSchedules.mockResolvedValue([schedule({ payment_id: "pay_1", payment_type: "ONE_TIME", installment_number: "1", installment_count: "2", amount_thb: "1500" })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"] });
    expect(deps.sendPush).toHaveBeenCalledOnce();
  });

  it("resolves legacy payment values from schedules when payment snapshots are absent", async () => {
    const deps = dependencies([payment({ payment_type: "", package_name: "", installment_number: "", installment_count: "", total_price_thb: "" })]);
    deps.listSchedules.mockResolvedValue([
      schedule({ schedule_id: "schedule_1", payment_type: "INSTALLMENTS", installment_number: "1", installment_count: "2", amount_thb: "1500" }),
      schedule({ schedule_id: "schedule_2", payment_type: "INSTALLMENTS", installment_number: "2", installment_count: "2", amount_thb: "1500", payment_id: "pay_1" }),
    ]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"] });

    expect(deps.sendPush.mock.calls[0]?.[0].messages[0].text).toContain("2nd payment out of 2 for Coaching");
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

  it("sends an explicitly requested future initial payment but not a later installment", async () => {
    const deps = dependencies([
      payment({ payment_id: "future-initial", due_date: "2026-08-11", payment_type: "INSTALLMENTS", installment_number: "1", installment_count: "2" }),
      payment({ payment_id: "future-later", due_date: "2026-08-11", payment_type: "INSTALLMENTS", installment_number: "2", installment_count: "2", rowNumber: 3 }),
    ]);

    await expect(sendDueLinePaymentRequests({
      baseUrl: "https://pay.example",
      today: "2026-08-10",
      paymentIds: ["future-initial", "future-later"],
    }, deps)).resolves.toMatchObject({ accepted: ["future-initial"] });
    expect(deps.sendPush).toHaveBeenCalledTimes(1);
  });

  it("sends requested payment IDs in the caller's deterministic order", async () => {
    const deps = dependencies([
      payment({ payment_id: "newer", due_date: "2026-08-10", created_at: "2026-08-02T00:00:00.000Z" }),
      payment({ payment_id: "older", due_date: "2026-08-09", created_at: "2026-08-01T00:00:00.000Z", rowNumber: 3 }),
    ]);

    await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10", paymentIds: ["older", "newer"] }, deps);

    expect(deps.sendPush.mock.calls.map(([request]) => request.messages[0].text)).toEqual([
      expect.stringContaining("Due date: 2026-08-09"),
      expect.stringContaining("Due date: 2026-08-10"),
    ]);
  });

  it("catches up a previously skipped payment after its client becomes linked", async () => {
    const deps = dependencies([payment({ line_message_status: "SKIPPED_MISSING_USER_ID", line_message_error: "MISSING_USER_ID" })]);

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"], skippedMissingUserId: [] });
    expect(deps.sendPush).toHaveBeenCalledTimes(1);
  });

  it("reuses frozen message and retry key after an ambiguous timeout even if the template changes", async () => {
    const stored = payment({ line_message_status: "FAILED_RETRYABLE", line_retry_key: "stored-key", line_message: "Frozen message", line_message_attempted_at: "2026-08-10T01:00:00.000Z" });
    const deps = dependencies([stored]);
    deps.sendPush.mockResolvedValueOnce({ accepted: false, retryable: true, requestId: "", errorCode: "NETWORK_ERROR" }).mockResolvedValueOnce({ accepted: true, retryable: false, requestId: "request_2", errorCode: "" });

    await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"] });
    expect(deps.createRetryKey).not.toHaveBeenCalled();
    expect(deps.getLineDueMessageProfiles).not.toHaveBeenCalled();
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
