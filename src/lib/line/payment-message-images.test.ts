import { describe, expect, it, vi } from "vitest";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";
import { lineImageMessage, selectLineTermsImage } from "./payment-message-images";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const version = { versionId: "terms_11111111111111111111111111111111", publicToken: "a".repeat(32), driveFileId: "file", mimeType: "image/png" as const, byteLength: png.length, originalName: "terms.png", uploadedAt: "2026-08-15T00:00:00.000Z" };
const payment = (installmentNumber: string) => ({ payment_id: "p", installment_number: installmentNumber } as PaymentRecord);

describe("LINE payment message images", () => {
  it("selects the validated active terms image only for initial payments", async () => {
    const dependencies = {
      getLineTermsImageState: vi.fn(async () => ({ activeVersionId: version.versionId, versions: [version] })),
      readDriveTermsImageFile: vi.fn(async () => ({ bytes: png, declaredMimeType: "image/png" as const })),
    };
    await expect(selectLineTermsImage({ payment: payment("1"), schedules: [] as ScheduleRecord[] }, dependencies)).resolves.toEqual({ token: version.publicToken });
    await expect(selectLineTermsImage({ payment: payment("2"), schedules: [] as ScheduleRecord[] }, dependencies)).resolves.toEqual({ token: "NONE" });
  });

  it("retains a valid frozen token and rejects an invalid one", async () => {
    const dependencies = { getLineTermsImageState: vi.fn(), readDriveTermsImageFile: vi.fn() };
    await expect(selectLineTermsImage({ payment: payment("1"), schedules: [], frozenToken: version.publicToken }, dependencies)).resolves.toEqual({ token: version.publicToken });
    await expect(selectLineTermsImage({ payment: payment("1"), schedules: [], frozenToken: "unsafe" }, dependencies)).resolves.toEqual({ token: "NONE", reasonCode: "CONFIG_INVALID" });
    expect(dependencies.getLineTermsImageState).not.toHaveBeenCalled();
  });

  it("builds identical LINE image fields", () => {
    expect(lineImageMessage("https://pay.example/image.png")).toEqual({ type: "image", originalContentUrl: "https://pay.example/image.png", previewImageUrl: "https://pay.example/image.png" });
  });
});
