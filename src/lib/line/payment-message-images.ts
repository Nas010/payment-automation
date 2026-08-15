import type { PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";
import type { readDriveTermsImageFile } from "@/lib/storage/drive-client";
import {
  activeLineTermsImageVersion,
  isLineTermsPublicToken,
  lineTermsImagePath,
  resolveLineTermsPlanPosition,
  validateLineTermsImageBytes,
  type LineTermsImageState,
} from "./terms-image";

export type TermsImageSelection = {
  token: string;
  reasonCode?: "NOT_CONFIGURED" | "CONFIG_INVALID" | "ASSET_UNAVAILABLE" | "POSITION_UNKNOWN";
};

export type PaymentMessageImageDependencies = {
  getLineTermsImageState: () => Promise<LineTermsImageState>;
  readDriveTermsImageFile: typeof readDriveTermsImageFile;
};

export function lineImageMessage(url: string) {
  return { type: "image" as const, originalContentUrl: url, previewImageUrl: url };
}

export function lineTermsImageUrl(baseUrl: string, publicToken: string): string {
  const url = new URL(lineTermsImagePath(publicToken), baseUrl);
  if (url.protocol !== "https:") throw new Error("HTTPS_BASE_URL_REQUIRED");
  return url.toString();
}

export async function selectLineTermsImage(
  input: { payment: PaymentRecord; schedules: readonly ScheduleRecord[]; frozenToken?: string },
  dependencies: PaymentMessageImageDependencies,
): Promise<TermsImageSelection> {
  if (input.frozenToken !== undefined) {
    if (!input.frozenToken || input.frozenToken === "NONE") return { token: "NONE" };
    return isLineTermsPublicToken(input.frozenToken)
      ? { token: input.frozenToken }
      : { token: "NONE", reasonCode: "CONFIG_INVALID" };
  }
  const legacySchedule = input.payment.installment_number
    ? undefined
    : input.schedules.find((schedule) => schedule.payment_id === input.payment.payment_id);
  const position = resolveLineTermsPlanPosition(input.payment, legacySchedule);
  if (position === "LATER") return { token: "NONE" };
  if (position === "UNKNOWN") return { token: "NONE", reasonCode: "POSITION_UNKNOWN" };
  let version;
  try {
    version = activeLineTermsImageVersion(await dependencies.getLineTermsImageState());
  } catch {
    return { token: "NONE", reasonCode: "CONFIG_INVALID" };
  }
  if (!version) return { token: "NONE", reasonCode: "NOT_CONFIGURED" };
  try {
    const file = await dependencies.readDriveTermsImageFile(version.driveFileId);
    if (validateLineTermsImageBytes(file.bytes) !== version.mimeType || file.bytes.byteLength !== version.byteLength) {
      throw new Error("asset mismatch");
    }
    return { token: version.publicToken };
  } catch {
    return { token: "NONE", reasonCode: "ASSET_UNAVAILABLE" };
  }
}
