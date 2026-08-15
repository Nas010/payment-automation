import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LINE_DUE_PROFILES,
  DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG,
  REMINDER_SLOTS,
  type ReminderSlot,
} from "./message-profile";
import { createDefaultLineMessageTestProfile, type LineMessageTestProfile, type LineMessageTestScenario } from "./message-test-profile";
import { previewLineMessageTest, sendLineMessageTest, type LineMessageTestDeliveryDependencies } from "./message-test-delivery";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const terms = { versionId: "terms_11111111111111111111111111111111", publicToken: "a".repeat(32), driveFileId: "file", mimeType: "image/png" as const, byteLength: png.length, originalName: "terms.png", uploadedAt: "2026-08-15T00:00:00.000Z" };

function profile(overrides: Partial<LineMessageTestProfile> = {}): LineMessageTestProfile {
  return {
    ...createDefaultLineMessageTestProfile("2026-08-15"),
    paymentType: "INSTALLMENTS",
    installmentCount: 3,
    intervalMonths: 1,
    totalPriceThb: "4500",
    lineUserId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    lineDisplayName: "Test Recipient",
    lineLinkStatus: "LINKED",
    lineLinkedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

function dependencies(current = profile()): LineMessageTestDeliveryDependencies & Record<string, ReturnType<typeof vi.fn>> {
  return {
    getProfile: vi.fn(async () => current),
    getDueProfiles: vi.fn(async () => ({ ONE_TIME: { kind: "VALID", profile: DEFAULT_LINE_DUE_PROFILES.ONE_TIME }, INSTALLMENTS: { kind: "VALID", profile: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS } })),
    getReminderConfig: vi.fn(async () => ({ kind: "VALID", config: DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG })),
    getLineTermsImageState: vi.fn(async () => ({ activeVersionId: terms.versionId, versions: [terms] })),
    readDriveTermsImageFile: vi.fn(async () => ({ bytes: png, declaredMimeType: "image/png" as const })),
    getLineChannelAccessToken: vi.fn(async () => "line-token-value-1234567890"),
    sendPush: vi.fn(async () => ({ accepted: true, retryable: false, requestId: "request_1", errorCode: "" })),
    appendAudit: vi.fn(async () => undefined),
    createRetryKey: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
    now: vi.fn(() => "2026-08-15T02:00:00.000Z"),
  } as LineMessageTestDeliveryDependencies & Record<string, ReturnType<typeof vi.fn>>;
}

const later = (slot: ReminderSlot): LineMessageTestScenario => ({ paymentType: "INSTALLMENTS", stage: "LATER", installmentNumber: 2, reminderSlot: slot });

describe("LINE message test delivery", () => {
  it("previews and sends initial one-time through the safe QR with terms", async () => {
    const deps = dependencies(profile({ paymentType: "ONE_TIME", installmentCount: 1, intervalMonths: 0 }));
    const scenario = { paymentType: "ONE_TIME", stage: "INITIAL" } as const;

    const preview = await previewLineMessageTest({ scenario, baseUrl: "https://pay.example" }, deps);
    expect(preview.text).toContain("LINE test recipient");
    expect(preview.messages).toEqual([
      { type: "text", text: preview.text },
      { type: "image", originalContentUrl: "https://pay.example/api/line/message-test-qr", previewImageUrl: "https://pay.example/api/line/message-test-qr" },
      { type: "image", originalContentUrl: `https://pay.example/api/line/terms-image/${terms.publicToken}`, previewImageUrl: `https://pay.example/api/line/terms-image/${terms.publicToken}` },
    ]);

    await expect(sendLineMessageTest({ scenario, baseUrl: "https://pay.example" }, deps)).resolves.toMatchObject({ outcome: "ACCEPTED", requestCode: "request_1" });
    expect(deps.sendPush).toHaveBeenCalledWith(expect.objectContaining({ to: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", retryKey: "11111111-1111-4111-8111-111111111111", messages: preview.messages }));
    expect(deps.appendAudit).toHaveBeenCalledTimes(1);
  });

  it.each(REMINDER_SLOTS)("uses the %s template for a later installment and omits terms", async (slot) => {
    const deps = dependencies();
    const preview = await previewLineMessageTest({ scenario: later(slot), baseUrl: "https://pay.example" }, deps);

    expect(preview.text).toContain(slot === "DUE_DATE"
      ? "Your 2nd payment out of 3"
      : DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles[slot].message.split("\n")[2]);
    expect(preview.messages).toHaveLength(2);
    expect(preview.messages[1]).toMatchObject({ originalContentUrl: "https://pay.example/api/line/message-test-qr" });
  });

  it("uses the installment profile for an initial installment", async () => {
    const preview = await previewLineMessageTest({ scenario: { paymentType: "INSTALLMENTS", stage: "INITIAL" }, baseUrl: "https://pay.example" }, dependencies());
    expect(preview.text).toContain("1st payment out of 3");
    expect(preview.messages).toHaveLength(3);
  });

  it("retries explicit retryable failures three times with one key then reports failed", async () => {
    const deps = dependencies();
    deps.sendPush.mockResolvedValue({ accepted: false, retryable: true, requestId: "", errorCode: "HTTP_500" });

    await expect(sendLineMessageTest({ scenario: later("T_MINUS_3_DAYS"), baseUrl: "https://pay.example" }, deps)).resolves.toMatchObject({ outcome: "FAILED", requestCode: "HTTP_500" });
    expect(deps.sendPush).toHaveBeenCalledTimes(3);
    expect(new Set(deps.sendPush.mock.calls.map((call) => call[0].retryKey))).toEqual(new Set(["11111111-1111-4111-8111-111111111111"]));
    expect(deps.appendAudit).toHaveBeenCalledTimes(1);
  });

  it("marks unresolved network acceptance and accepted delivery with failed audit for review", async () => {
    const network = dependencies();
    network.sendPush.mockResolvedValue({ accepted: false, retryable: true, requestId: "", errorCode: "NETWORK_ERROR" });
    await expect(sendLineMessageTest({ scenario: later("T_MINUS_1_DAY"), baseUrl: "https://pay.example" }, network)).resolves.toMatchObject({ outcome: "REVIEW", requestCode: "NETWORK_ERROR" });

    const auditFailure = dependencies();
    auditFailure.appendAudit.mockRejectedValue(new Error("workbook unavailable"));
    await expect(sendLineMessageTest({ scenario: later("DUE_DATE"), baseUrl: "https://pay.example" }, auditFailure)).resolves.toMatchObject({ outcome: "REVIEW", requestCode: "AUDIT_FAILED" });
  });

  it("does not send for a disconnected recipient or an invalid template", async () => {
    const disconnected = dependencies(profile({ lineUserId: "", lineLinkStatus: "" }));
    await expect(sendLineMessageTest({ scenario: later("DUE_DATE"), baseUrl: "https://pay.example" }, disconnected)).resolves.toMatchObject({ outcome: "FAILED", requestCode: "RECIPIENT_NOT_LINKED" });
    expect(disconnected.getLineChannelAccessToken).not.toHaveBeenCalled();
    expect(disconnected.sendPush).not.toHaveBeenCalled();

    const invalid = dependencies();
    invalid.getReminderConfig.mockResolvedValue({ kind: "INVALID" });
    await expect(sendLineMessageTest({ scenario: later("DUE_DATE"), baseUrl: "https://pay.example" }, invalid)).resolves.toMatchObject({ outcome: "FAILED", requestCode: "TEMPLATE_INVALID" });
    expect(invalid.sendPush).not.toHaveBeenCalled();
  });
});
