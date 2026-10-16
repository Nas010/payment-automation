import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG } from "./message-profile";
import { sendInstallmentReminderRequests } from "./installment-reminders";

const mocks = vi.hoisted(() => ({
  runtimeConfig: vi.fn(),
  getLineChannelAccessToken: vi.fn(),
  appendAudit: vi.fn(),
  updatePayment: vi.fn(),
  updatePaymentIfUnchanged: vi.fn(),
  getPaymentById: vi.fn(),
  readPaymentClientSnapshot: vi.fn(),
  getLineInstallmentReminderConfig: vi.fn(),
  renderLineDueMessageProfile: vi.fn(),
  resolveLineDueMessageValues: vi.fn(),
  isLinkedLinePaymentRecipient: vi.fn(),
  sendLinePushMessage: vi.fn(),
}));

vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("@/lib/secrets/service", () => ({ getLineChannelAccessToken: mocks.getLineChannelAccessToken }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit, updatePayment: mocks.updatePayment, updatePaymentIfUnchanged: mocks.updatePaymentIfUnchanged, getPaymentById: mocks.getPaymentById }));
vi.mock("@/lib/sheets/payment-client-snapshot", () => ({ readPaymentClientSnapshot: mocks.readPaymentClientSnapshot }));
vi.mock("@/lib/sheets/settings", () => ({ getLineInstallmentReminderConfig: mocks.getLineInstallmentReminderConfig }));
vi.mock("./message-profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./message-profile")>();
  return { ...actual, renderLineDueMessageProfile: mocks.renderLineDueMessageProfile };
});
vi.mock("./message-values", () => ({ resolveLineDueMessageValues: mocks.resolveLineDueMessageValues }));
vi.mock("./recipient", () => ({ isLinkedLinePaymentRecipient: mocks.isLinkedLinePaymentRecipient }));
vi.mock("./client", () => ({ sendLinePushMessage: mocks.sendLinePushMessage }));

function payment(deliveryLog = "") {
  return {
    payment_id: "pay_1",
    client_id: "client_1",
    status: "PENDING",
    payment_type: "INSTALLMENTS",
    installment_number: "2",
    due_date: "2026-08-23",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    public_token: "token_1",
    line_reminder_delivery_log: deliveryLog,
  };
}

function linkedClient() {
  return { client_id: "client_1", line_user_id: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
}

function reminderConfig(enabled: boolean) {
  const config = structuredClone(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
  config.enabled.T_MINUS_7_DAYS = enabled;
  return { kind: "VALID" as const, config };
}

function allDisabledReminderConfig() {
  const config = structuredClone(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
  config.enabled = {
    T_MINUS_7_DAYS: false,
    T_MINUS_3_DAYS: false,
    T_MINUS_1_DAY: false,
    DUE_DATE: false,
    T_PLUS_1_DAY: false,
  };
  return { kind: "VALID" as const, config };
}

function expectNoDeliveryWork() {
  expect(mocks.getLineChannelAccessToken).not.toHaveBeenCalled();
  expect(mocks.isLinkedLinePaymentRecipient).not.toHaveBeenCalled();
  expect(mocks.resolveLineDueMessageValues).not.toHaveBeenCalled();
  expect(mocks.renderLineDueMessageProfile).not.toHaveBeenCalled();
  expect(mocks.updatePayment).not.toHaveBeenCalled();
  expect(mocks.updatePaymentIfUnchanged).not.toHaveBeenCalled();
  expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
  expect(mocks.appendAudit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtimeConfig.mockResolvedValue({ lineMessagingEnabled: true });
  mocks.getLineChannelAccessToken.mockResolvedValue("line-token");
  mocks.appendAudit.mockResolvedValue(undefined);
  mocks.updatePayment.mockResolvedValue(undefined);
  mocks.updatePaymentIfUnchanged.mockResolvedValue(true);
  mocks.getPaymentById.mockResolvedValue(null);
  mocks.readPaymentClientSnapshot.mockResolvedValue({ payments: [payment()], clients: [linkedClient()], schedules: [] });
  mocks.getLineInstallmentReminderConfig.mockResolvedValue(reminderConfig(true));
  mocks.isLinkedLinePaymentRecipient.mockReturnValue(true);
  mocks.resolveLineDueMessageValues.mockReturnValue({ values: {} });
  mocks.renderLineDueMessageProfile.mockReturnValue("Rendered reminder");
  mocks.sendLinePushMessage.mockResolvedValue({ accepted: true, retryable: false, requestId: "request_1", errorCode: "" });
});

describe("sendInstallmentReminderRequests", () => {
  it("does not send or revive a reminder when a stale snapshot loses to VOID", async () => {
    mocks.updatePaymentIfUnchanged.mockResolvedValue(false);

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual([]);

    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledWith({
      expectedPayment: payment(),
      payment: expect.objectContaining({ status: "PENDING", line_reminder_delivery_log: expect.stringContaining('"status":"SENDING"') }),
    });
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "LINE_INSTALLMENT_REMINDER_DEFERRED",
      metadata: expect.stringContaining("PAYMENT_STATE_CHANGED"),
    }));
  });

  it("retries a repaired state token only while the complete invoice is unchanged", async () => {
    mocks.updatePaymentIfUnchanged.mockResolvedValueOnce(false).mockResolvedValue(true);
    mocks.getPaymentById.mockResolvedValue(payment());

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual(["pay_1"]);

    expect(mocks.getPaymentById).toHaveBeenCalledWith("pay_1");
    expect(mocks.sendLinePushMessage).toHaveBeenCalledOnce();
  });

  it("does not send when a refreshed invoice has already been paid", async () => {
    mocks.updatePaymentIfUnchanged.mockResolvedValueOnce(false);
    mocks.getPaymentById.mockResolvedValue({ ...payment(), status: "MANUAL_CONFIRMED" });

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual([]);

    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledOnce();
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
  });

  it("persists missing recipients instead of losing the reason in memory", async () => {
    mocks.isLinkedLinePaymentRecipient.mockReturnValue(false);

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual([]);

    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({
      payment: expect.objectContaining({ line_reminder_delivery_log: expect.stringContaining("SKIPPED_MISSING_USER_ID") }),
    }));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_INSTALLMENT_REMINDER_SKIPPED" }));
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
  });

  it("persists template failures so the next job can retry after a repair", async () => {
    mocks.renderLineDueMessageProfile.mockImplementation(() => { throw new Error("private template detail"); });

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual([]);

    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({
      payment: expect.objectContaining({ line_reminder_delivery_log: expect.stringContaining("FAILED_RETRYABLE") }),
    }));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.stringContaining("TEMPLATE_INVALID") }));
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("private template detail");
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
  });

  it.each(["2026-08-16", "2026-08-17"])("recovers a persisted preparation failure on %s and never resends an accepted slot", async (recoveryDay) => {
    let stored = payment();
    mocks.readPaymentClientSnapshot.mockImplementation(async () => ({ payments: [{ ...stored }], clients: [linkedClient()], schedules: [] }));
    mocks.updatePaymentIfUnchanged.mockImplementation(async ({ expectedPayment, payment: next }) => {
      if (JSON.stringify(expectedPayment) !== JSON.stringify(stored)) return false;
      stored = next;
      return true;
    });
    mocks.renderLineDueMessageProfile.mockImplementationOnce(() => { throw new Error("template unavailable"); });

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual([]);
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expect(JSON.parse(stored.line_reminder_delivery_log).deliveries.T_MINUS_7_DAYS.status).toBe("FAILED_RETRYABLE");

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: recoveryDay })).resolves.toEqual(["pay_1"]);
    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: recoveryDay })).resolves.toEqual([]);
    expect(mocks.sendLinePushMessage).toHaveBeenCalledOnce();
  });

  it("persists a credentials failure for every due invoice instead of aborting the job", async () => {
    mocks.readPaymentClientSnapshot.mockResolvedValue({
      payments: [payment(), { ...payment(), payment_id: "pay_2" }], clients: [linkedClient()], schedules: [],
    });
    mocks.getLineChannelAccessToken.mockRejectedValue(new Error("private credential detail"));

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual([]);

    const failedIds = mocks.updatePaymentIfUnchanged.mock.calls.map(([input]) => input.payment)
      .filter(row => row.line_reminder_delivery_log.includes("CREDENTIALS_UNAVAILABLE")).map(row => row.payment_id);
    expect(failedIds).toEqual(["pay_1", "pay_2"]);
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
  });

  it("continues with the next invoice when a row has an invalid date", async () => {
    mocks.readPaymentClientSnapshot.mockResolvedValue({
      payments: [{ ...payment(), payment_id: "bad_date", due_date: "2026-99-99" }, payment()],
      clients: [linkedClient()], schedules: [],
    });

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual(["pay_1"]);

    expect(mocks.sendLinePushMessage).toHaveBeenCalledOnce();
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ paymentId: "bad_date", metadata: expect.stringContaining("INVALID_REMINDER_DATE") }));
  });

  it("keeps a retry key and processes other invoices after a transport exception", async () => {
    mocks.readPaymentClientSnapshot.mockResolvedValue({
      payments: [payment(), { ...payment(), payment_id: "pay_2" }], clients: [linkedClient()], schedules: [],
    });
    mocks.sendLinePushMessage.mockRejectedValueOnce(new Error("private transport detail"));

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual(["pay_2"]);

    const retryWrite = mocks.updatePaymentIfUnchanged.mock.calls.map(([input]) => input.payment).find(row => row.payment_id === "pay_1" && row.line_reminder_delivery_log.includes("FAILED_RETRYABLE"));
    expect(JSON.parse(retryWrite.line_reminder_delivery_log).deliveries.T_MINUS_7_DAYS).toMatchObject({ errorCode: "NETWORK_ERROR", renderedMessage: "Rendered reminder", retryKey: expect.any(String) });
    expect(mocks.sendLinePushMessage).toHaveBeenCalledTimes(2);
  });

  it("does not let an unavailable audit log stop delivery to other clients", async () => {
    mocks.readPaymentClientSnapshot.mockResolvedValue({
      payments: [payment(), { ...payment(), payment_id: "pay_2" }], clients: [linkedClient()], schedules: [],
    });
    mocks.appendAudit.mockRejectedValue(new Error("private audit failure"));

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual(["pay_1", "pay_2"]);

    expect(mocks.sendLinePushMessage).toHaveBeenCalledTimes(2);
  });

  it("requires review before retrying an ambiguous request outside LINE's 24 hour deduplication window", async () => {
    const log = JSON.stringify({ version: 1, deliveries: { T_MINUS_7_DAYS: {
      status: "SENDING", retryKey: "old-key", renderedMessage: "Frozen", firstAttemptedAt: "2020-01-01T00:00:00.000Z",
    } } });
    mocks.readPaymentClientSnapshot.mockResolvedValue({ payments: [payment(log)], clients: [linkedClient()], schedules: [] });

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-17" })).resolves.toEqual([]);

    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({
      payment: expect.objectContaining({ line_reminder_delivery_log: expect.stringContaining("DELIVERY_AMBIGUOUS") }),
    }));
  });

  it("does not resolve a recipient when all scheduled slots are disabled", async () => {
    mocks.getLineInstallmentReminderConfig.mockResolvedValue(allDisabledReminderConfig());
    const clientLookup = vi.spyOn(Map.prototype, "get");

    try {
      await expect(sendInstallmentReminderRequests({
        baseUrl: "https://pay.example",
        today: "2026-08-16",
      })).resolves.toEqual([]);

      expect(clientLookup).not.toHaveBeenCalledWith("client_1");
      expectNoDeliveryWork();
    } finally {
      clientLookup.mockRestore();
    }
  });

  it("delivers an enabled scheduled reminder slot", async () => {
    await expect(sendInstallmentReminderRequests({
      baseUrl: "https://pay.example",
      today: "2026-08-16",
    })).resolves.toEqual(["pay_1"]);

    expect(mocks.renderLineDueMessageProfile).toHaveBeenCalledWith(
      DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles.T_MINUS_7_DAYS,
      "INSTALLMENTS",
      {},
    );
    expect(mocks.sendLinePushMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      messages: expect.arrayContaining([{ type: "text", text: "Rendered reminder" }]),
    }));
  });

  it("pauses disabled retries then resumes with their frozen payload", async () => {
    const retryLog = JSON.stringify({
      version: 1,
      deliveries: {
        T_MINUS_7_DAYS: {
          status: "FAILED_RETRYABLE",
          renderedMessage: "Frozen reminder",
          retryKey: "retry-key-1",
          errorCode: "HTTP_500",
        },
      },
    });
    mocks.readPaymentClientSnapshot.mockResolvedValue({ payments: [payment(retryLog)], clients: [linkedClient()], schedules: [] });
    mocks.getLineInstallmentReminderConfig.mockResolvedValue(reminderConfig(false));

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual([]);
    expectNoDeliveryWork();

    vi.clearAllMocks();
    mocks.runtimeConfig.mockResolvedValue({ lineMessagingEnabled: true });
    mocks.getLineChannelAccessToken.mockResolvedValue("line-token");
    mocks.appendAudit.mockResolvedValue(undefined);
    mocks.updatePayment.mockResolvedValue(undefined);
    mocks.readPaymentClientSnapshot.mockResolvedValue({ payments: [payment(retryLog)], clients: [linkedClient()], schedules: [] });
    mocks.getLineInstallmentReminderConfig.mockResolvedValue(reminderConfig(true));
    mocks.isLinkedLinePaymentRecipient.mockReturnValue(true);
    mocks.sendLinePushMessage.mockResolvedValue({ accepted: true, retryable: false, requestId: "request_1", errorCode: "" });

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual(["pay_1"]);

    expect(mocks.sendLinePushMessage).toHaveBeenCalledWith(expect.objectContaining({
      retryKey: "retry-key-1",
      messages: expect.arrayContaining([{ type: "text", text: "Frozen reminder" }]),
    }));
    expect(mocks.resolveLineDueMessageValues).not.toHaveBeenCalled();
    expect(mocks.renderLineDueMessageProfile).not.toHaveBeenCalled();
  });

  it("does not backfill a scheduled slot enabled after its date", async () => {
    mocks.getLineInstallmentReminderConfig.mockResolvedValue(reminderConfig(false));

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-16" })).resolves.toEqual([]);
    expectNoDeliveryWork();

    vi.clearAllMocks();
    mocks.runtimeConfig.mockResolvedValue({ lineMessagingEnabled: true });
    mocks.getLineChannelAccessToken.mockResolvedValue("line-token");
    mocks.appendAudit.mockResolvedValue(undefined);
    mocks.updatePayment.mockResolvedValue(undefined);
    mocks.readPaymentClientSnapshot.mockResolvedValue({ payments: [payment()], clients: [linkedClient()], schedules: [] });
    mocks.getLineInstallmentReminderConfig.mockResolvedValue(reminderConfig(true));
    mocks.isLinkedLinePaymentRecipient.mockReturnValue(true);
    mocks.resolveLineDueMessageValues.mockReturnValue({ values: {} });
    mocks.renderLineDueMessageProfile.mockReturnValue("Rendered reminder");
    mocks.sendLinePushMessage.mockResolvedValue({ accepted: true, retryable: false, requestId: "request_1", errorCode: "" });

    await expect(sendInstallmentReminderRequests({ baseUrl: "https://pay.example", today: "2026-08-17" })).resolves.toEqual([]);
    expectNoDeliveryWork();
  });
});
