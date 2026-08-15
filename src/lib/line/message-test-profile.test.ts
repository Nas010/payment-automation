import { describe, expect, it } from "vitest";
import { eligibleReminderSlots, emptyReminderDeliveryLog } from "./reminder-delivery";
import {
  LINE_MESSAGE_TEST_PROFILE_SETTING_KEY,
  LINE_MESSAGE_TEST_SUBJECT_ID,
  buildLineMessageTestFixture,
  createDefaultLineMessageTestProfile,
  mergeLineMessageTestDetails,
  parseLineMessageTestDetails,
  parseLineMessageTestProfile,
  toLineMessageTestAdminView,
  type LineMessageTestProfile,
  type LineMessageTestScenario,
} from "./message-test-profile";

function installmentProfile(overrides: Partial<LineMessageTestProfile> = {}): LineMessageTestProfile {
  return {
    version: 1,
    clientName: "Test Client",
    packageName: "Test Coaching",
    totalPriceThb: "1000.00",
    paymentType: "INSTALLMENTS",
    installmentCount: 3,
    intervalMonths: 1,
    firstDueDate: "2026-01-15",
    lineUserId: "U0123456789abcdef0123456789abcdef",
    lineDisplayName: "LINE Test Recipient",
    linePictureUrl: "https://profile.example/test.png",
    lineLinkStatus: "LINKED",
    lineLinkedAt: "2026-08-01T00:00:00.000Z",
    lineLinkError: "",
    lineLinkTokenHash: "a".repeat(64),
    lineLinkTokenEncrypted: "encrypted-test-token",
    lineLinkTokenExpiresAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("LINE message test profile", () => {
  it("defines stable setting and connection subject identifiers", () => {
    expect(LINE_MESSAGE_TEST_PROFILE_SETTING_KEY).toBe("line_message_test_profile");
    expect(LINE_MESSAGE_TEST_SUBJECT_ID).toBe("line-message-test-profile");
  });

  it("creates a disconnected one-time default for supplied date", () => {
    expect(createDefaultLineMessageTestProfile("2026-08-15")).toMatchObject({
      version: 1,
      paymentType: "ONE_TIME",
      installmentCount: 1,
      intervalMonths: 0,
      firstDueDate: "2026-08-15",
      lineUserId: "",
      lineLinkStatus: "",
    });
  });

  it("parses versioned stored profile JSON and normalizes one-time plan fields", () => {
    const profile = parseLineMessageTestProfile(JSON.stringify(installmentProfile({
      paymentType: "ONE_TIME",
      installmentCount: 9,
      intervalMonths: 4,
    })));

    expect(profile).toMatchObject({ paymentType: "ONE_TIME", installmentCount: 1, intervalMonths: 0 });
  });

  it("parses editable form details and normalizes one-time plan fields", () => {
    const details = parseLineMessageTestDetails({
      clientName: "  Edited Client  ",
      packageName: "  Edited Package  ",
      totalPriceThb: "1000.01",
      paymentType: "ONE_TIME",
      installmentCount: "9",
      intervalMonths: "4",
      firstDueDate: "2026-08-15",
    });

    expect(details).toEqual({
      clientName: "Edited Client",
      packageName: "Edited Package",
      totalPriceThb: "1000.01",
      paymentType: "ONE_TIME",
      installmentCount: 1,
      intervalMonths: 0,
      firstDueDate: "2026-08-15",
    });
  });

  it("preserves every LINE connection field while saving editable details", () => {
    const profile = installmentProfile({ lineLinkError: "SAFE_ERROR" });
    const saved = mergeLineMessageTestDetails(profile, {
      clientName: "Edited Client",
      packageName: "Edited Package",
      totalPriceThb: "2000.00",
      paymentType: "INSTALLMENTS",
      installmentCount: 4,
      intervalMonths: 2,
      firstDueDate: "2026-09-01",
    }, "2026-08-15T03:00:00.000Z");

    for (const key of Object.keys(profile).filter((key) => key.startsWith("line")) as Array<keyof LineMessageTestProfile>) {
      expect(saved[key]).toEqual(profile[key]);
    }
    expect(saved).toMatchObject({
      clientName: "Edited Client",
      packageName: "Edited Package",
      totalPriceThb: "2000.00",
      updatedAt: "2026-08-15T03:00:00.000Z",
    });
  });

  it("redacts private identity and connection token fields from admin views", () => {
    const admin = toLineMessageTestAdminView(installmentProfile({ lineLinkError: "SAFE_ERROR" }));

    expect(admin).toMatchObject({
      lineDisplayName: "LINE Test Recipient",
      linePictureUrl: "https://profile.example/test.png",
      lineLinkStatus: "LINKED",
      lineLinkedAt: "2026-08-01T00:00:00.000Z",
      lineLinkError: "SAFE_ERROR",
    });
    expect(admin).not.toHaveProperty("lineUserId");
    expect(admin).not.toHaveProperty("lineLinkTokenHash");
    expect(admin).not.toHaveProperty("lineLinkTokenEncrypted");
    expect(admin).not.toHaveProperty("lineLinkTokenExpiresAt");
  });

  it.each([
    [{ paymentType: "ONE_TIME", stage: "INITIAL" }, "ONE_TIME"],
    [{ paymentType: "INSTALLMENTS", stage: "INITIAL" }, "INSTALLMENTS"],
    [{ paymentType: "INSTALLMENTS", stage: "LATER", installmentNumber: 2, reminderSlot: "T_MINUS_3_DAYS" }, "INSTALLMENTS"],
  ] as const)("builds supported scenario %j", (scenario, paymentType) => {
    const fixture = buildLineMessageTestFixture({ profile: installmentProfile(), scenario, baseUrl: "https://pay.example", now: "2026-08-15T03:00:00.000Z" });

    expect(fixture.payment.payment_type).toBe(paymentType);
    expect(fixture.payment.payment_url).toBe("https://pay.example/line/message-test");
    expect(fixture.payment.public_token).toBe("");
    expect(fixture.payment.rowNumber).toBe(0);
    expect(fixture.schedules.every((schedule) => schedule.schedule_id.startsWith("line_test_"))).toBe(true);
  });

  it("uses production allocation, due-date math, and simulated reminder day", () => {
    const fixture = buildLineMessageTestFixture({
      profile: installmentProfile({ totalPriceThb: "1000.01", firstDueDate: "2026-01-31" }),
      scenario: { paymentType: "INSTALLMENTS", stage: "LATER", installmentNumber: 3, reminderSlot: "T_MINUS_1_DAY" },
      baseUrl: "https://pay.example",
      now: "2026-08-15T03:00:00.000Z",
    });

    expect(fixture.payment.amount_thb).toBe("333.35");
    expect(fixture.payment.due_date).toBe("2026-03-31");
    expect(fixture.simulatedToday).toBe("2026-03-30");
    expect(eligibleReminderSlots({ dueDate: fixture.payment.due_date, createdAt: fixture.payment.created_at, today: fixture.simulatedToday!, log: emptyReminderDeliveryLog() })).toContain("T_MINUS_1_DAY");
  });

  it.each([
    ["later one-time", { paymentType: "ONE_TIME", stage: "LATER", installmentNumber: 2, reminderSlot: "DUE_DATE" }],
    ["first installment as later", { paymentType: "INSTALLMENTS", stage: "LATER", installmentNumber: 1, reminderSlot: "DUE_DATE" }],
    ["installment number above configured count", { paymentType: "INSTALLMENTS", stage: "LATER", installmentNumber: 4, reminderSlot: "DUE_DATE" }],
    ["missing reminder slot", { paymentType: "INSTALLMENTS", stage: "LATER", installmentNumber: 2 }],
  ])("rejects %s scenario", (_label, scenario) => {
    expect(() => buildLineMessageTestFixture({
      profile: installmentProfile(),
      scenario: scenario as LineMessageTestScenario,
      baseUrl: "https://pay.example",
      now: "2026-08-15T03:00:00.000Z",
    })).toThrow();
  });

  it.each([
    ["invalid THB", { totalPriceThb: "not-money" }],
    ["invalid date", { firstDueDate: "2026-02-30" }],
    ["installment count below two", { installmentCount: 1 }],
    ["installment interval below one", { intervalMonths: 0 }],
  ])("rejects %s profile details", (_label, overrides) => {
    expect(() => parseLineMessageTestProfile({ ...installmentProfile(), ...overrides })).toThrow();
  });
});
