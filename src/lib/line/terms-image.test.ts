import { describe, expect, it } from "vitest";
import {
  LineTermsImageError,
  activateLineTermsImageVersion,
  activeLineTermsImageVersion,
  findLineTermsImageByPublicToken,
  isFirstPlanPayment,
  lineTermsImagePath,
  parseLineTermsImageState,
  resolveLineTermsPlanPosition,
  validateLineTermsImageBytes,
  type LineTermsImageVersion,
} from "./terms-image";

const firstVersion: LineTermsImageVersion = {
  versionId: "terms_abcdefghijklmnopqrstuvwxyzABCDEF",
  publicToken: "abcdefghijklmnopqrstuvwxyzABCDEF",
  driveFileId: "drive-file-123",
  mimeType: "image/png",
  byteLength: 9,
  originalName: "terms.png",
  uploadedAt: "2026-08-15T01:00:00.000Z",
};

describe("LINE terms image assets", () => {
  it("accepts genuine PNG and JPEG bytes while rejecting empty or spoofed files", () => {
    expect(() => validateLineTermsImageBytes(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]))).not.toThrow();
    expect(() => validateLineTermsImageBytes(new Uint8Array([255, 216, 255, 0]))).not.toThrow();
    expect(() => validateLineTermsImageBytes(new Uint8Array())).toThrow(LineTermsImageError);
    expect(() => validateLineTermsImageBytes(new Uint8Array([1, 2, 3, 4]))).toThrow("PNG or JPEG");
  });

  it("rejects a terms image larger than 1 MiB", () => {
    expect(() => validateLineTermsImageBytes(new Uint8Array(1024 * 1024 + 1))).toThrow("1 MiB");
  });

  it("activates a new immutable version without removing its history", () => {
    const secondVersion = {
      ...firstVersion,
      versionId: "terms_0123456789abcdefghijklmnopqrstuvwxyzAB",
      publicToken: "0123456789abcdefghijklmnopqrstuvwxyzAB",
      driveFileId: "drive-file-456",
      originalName: "terms-v2.png",
    };

    const next = activateLineTermsImageVersion({ activeVersionId: firstVersion.versionId, versions: [firstVersion] }, secondVersion);

    expect(next).toEqual({ activeVersionId: secondVersion.versionId, versions: [firstVersion, secondVersion] });
    expect(activeLineTermsImageVersion(next)).toEqual(secondVersion);
    expect(findLineTermsImageByPublicToken(next, firstVersion.publicToken)).toEqual(firstVersion);
  });

  it("treats empty settings as no image and rejects corrupt active state", () => {
    expect(parseLineTermsImageState([])).toEqual({ activeVersionId: "", versions: [] });
    expect(() => parseLineTermsImageState([
      { rowNumber: 2, key: "line_terms_image_active_version", value: firstVersion.versionId },
      { rowNumber: 3, key: "line_terms_image_versions", value: "not JSON" },
    ])).toThrow("invalid terms image configuration");
  });

  it("makes only registered public tokens into image paths", () => {
    expect(lineTermsImagePath(firstVersion.publicToken)).toBe(`/api/line/terms-image/${firstVersion.publicToken}`);
    expect(() => lineTermsImagePath("drive-file-123")).toThrow("invalid public token");
  });
});

describe("first payment detection", () => {
  it("uses payment snapshot first, with schedule fallback only for legacy payments", () => {
    expect(resolveLineTermsPlanPosition({ installment_number: "1" })).toBe("FIRST");
    expect(resolveLineTermsPlanPosition({ installment_number: "10" })).toBe("LATER");
    expect(resolveLineTermsPlanPosition({ installment_number: "" }, { installment_number: "1" })).toBe("FIRST");
    expect(resolveLineTermsPlanPosition({ installment_number: "" }, { installment_number: "" })).toBe("UNKNOWN");
    expect(isFirstPlanPayment({ installment_number: "1" }, { installment_number: "2" })).toBe(true);
  });
});
