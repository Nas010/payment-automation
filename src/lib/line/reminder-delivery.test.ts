import { describe, expect, it } from "vitest";
import {
  eligibleReminderSlots,
  emptyReminderDeliveryLog,
  parseReminderDeliveryLog,
  reminderDate,
} from "./reminder-delivery";

describe("reminder delivery scheduling", () => {
  it("selects T_MINUS_1_DAY for a payment created two days before its deadline", () => {
    expect(eligibleReminderSlots({
      dueDate: "2026-08-20",
      createdAt: "2026-08-18T08:00:00.000Z",
      today: "2026-08-19",
      log: emptyReminderDeliveryLog(),
    })).toEqual(["T_MINUS_1_DAY"]);
  });

  it("does not backfill slots before payment creation", () => {
    expect(eligibleReminderSlots({
      dueDate: "2026-08-20",
      createdAt: "2026-08-18T08:00:00.000Z",
      today: "2026-08-18",
      log: emptyReminderDeliveryLog(),
    })).toEqual([]);
  });

  it("keeps a failed reminder eligible with its frozen retry payload", () => {
    const log = parseReminderDeliveryLog(JSON.stringify({
      version: 1,
      deliveries: {
        T_MINUS_7_DAYS: { status: "FAILED_RETRYABLE", renderedMessage: "Frozen", retryKey: "retry_1" },
      },
    }));
    expect(eligibleReminderSlots({ dueDate: "2026-08-20", createdAt: "2026-08-10T00:00:00.000Z", today: "2026-08-14", log })).toEqual(["T_MINUS_7_DAYS"]);
  });

  it("never selects an accepted reminder again and resolves T+1", () => {
    const log = parseReminderDeliveryLog(JSON.stringify({
      version: 1,
      deliveries: { T_PLUS_1_DAY: { status: "ACCEPTED", acceptedAt: "2026-08-21T00:00:00.000Z" } },
    }));
    expect(reminderDate("2026-08-20", "T_PLUS_1_DAY")).toBe("2026-08-21");
    expect(eligibleReminderSlots({ dueDate: "2026-08-20", createdAt: "2026-08-01T00:00:00.000Z", today: "2026-08-21", log })).toEqual([]);
  });
});
