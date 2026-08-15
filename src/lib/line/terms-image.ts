import type { OperationalSetting } from "@/lib/sheets/settings";

export const MAX_LINE_TERMS_IMAGE_BYTES = 1024 * 1024;
export const LINE_TERMS_ACTIVE_VERSION_KEY = "line_terms_image_active_version";
export const LINE_TERMS_VERSIONS_KEY = "line_terms_image_versions";

export type LineTermsImageMimeType = "image/jpeg" | "image/png";

export type LineTermsImageVersion = {
  versionId: string;
  publicToken: string;
  driveFileId: string;
  mimeType: LineTermsImageMimeType;
  byteLength: number;
  originalName: string;
  uploadedAt: string;
};

export type LineTermsImageState = {
  activeVersionId: string;
  versions: LineTermsImageVersion[];
};

export type LineTermsImageErrorCode = "INVALID_FILE" | "FILE_TOO_LARGE" | "CONFIG_INVALID";

export class LineTermsImageError extends Error {
  constructor(public readonly code: LineTermsImageErrorCode, message: string) {
    super(message);
    this.name = "LineTermsImageError";
  }
}

const ID_PATTERN = /^terms_[A-Za-z0-9_-]{32,128}$/;
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function validateLineTermsImageBytes(bytes: Uint8Array): LineTermsImageMimeType {
  if (!bytes.length) throw new LineTermsImageError("INVALID_FILE", "Terms image must not be empty");
  if (bytes.byteLength > MAX_LINE_TERMS_IMAGE_BYTES) {
    throw new LineTermsImageError("FILE_TOO_LARGE", "Terms image must be 1 MiB or smaller");
  }
  const isPng = PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  const isJpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (isPng) return "image/png";
  if (isJpeg) return "image/jpeg";
  throw new LineTermsImageError("INVALID_FILE", "Terms image must be a PNG or JPEG");
}

function configError(): never {
  throw new LineTermsImageError("CONFIG_INVALID", "invalid terms image configuration");
}

function isMimeType(value: unknown): value is LineTermsImageMimeType {
  return value === "image/png" || value === "image/jpeg";
}

function isSafeOriginalName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && !/[\\/]/.test(value);
}

function isValidVersion(value: unknown): value is LineTermsImageVersion {
  if (!value || typeof value !== "object") return false;
  const version = value as Partial<LineTermsImageVersion>;
  return typeof version.versionId === "string"
    && ID_PATTERN.test(version.versionId)
    && typeof version.publicToken === "string"
    && PUBLIC_TOKEN_PATTERN.test(version.publicToken)
    && typeof version.driveFileId === "string"
    && version.driveFileId.length > 0
    && isMimeType(version.mimeType)
    && typeof version.byteLength === "number"
    && Number.isSafeInteger(version.byteLength)
    && version.byteLength > 0
    && version.byteLength <= MAX_LINE_TERMS_IMAGE_BYTES
    && isSafeOriginalName(version.originalName)
    && typeof version.uploadedAt === "string"
    && !Number.isNaN(Date.parse(version.uploadedAt));
}

function validateState(state: LineTermsImageState): LineTermsImageState {
  if (typeof state.activeVersionId !== "string" || !Array.isArray(state.versions) || !state.versions.every(isValidVersion)) configError();
  const versionIds = new Set(state.versions.map((version) => version.versionId));
  const publicTokens = new Set(state.versions.map((version) => version.publicToken));
  if (versionIds.size !== state.versions.length || publicTokens.size !== state.versions.length) configError();
  if (state.activeVersionId && !versionIds.has(state.activeVersionId)) configError();
  if (!state.activeVersionId && state.versions.length) configError();
  return state;
}

export function parseLineTermsImageState(settings: readonly OperationalSetting[]): LineTermsImageState {
  const values = new Map(settings.map((setting) => [setting.key, setting.value]));
  const activeVersionId = values.get(LINE_TERMS_ACTIVE_VERSION_KEY) ?? "";
  const rawVersions = values.get(LINE_TERMS_VERSIONS_KEY);
  if (rawVersions === undefined || rawVersions === "") {
    if (activeVersionId) configError();
    return { activeVersionId: "", versions: [] };
  }
  try {
    const versions = JSON.parse(rawVersions);
    return validateState({ activeVersionId, versions });
  } catch (error) {
    if (error instanceof LineTermsImageError) throw error;
    return configError();
  }
}

export function activateLineTermsImageVersion(state: LineTermsImageState, version: LineTermsImageVersion): LineTermsImageState {
  validateState(state);
  if (!isValidVersion(version)) configError();
  if (state.versions.some((item) => item.versionId === version.versionId || item.publicToken === version.publicToken)) configError();
  return { activeVersionId: version.versionId, versions: [...state.versions, version] };
}

export function activeLineTermsImageVersion(state: LineTermsImageState): LineTermsImageVersion | null {
  validateState(state);
  return state.versions.find((version) => version.versionId === state.activeVersionId) ?? null;
}

export function findLineTermsImageByPublicToken(state: LineTermsImageState, token: string): LineTermsImageVersion | null {
  if (!isLineTermsPublicToken(token)) return null;
  validateState(state);
  return state.versions.find((version) => version.publicToken === token) ?? null;
}

export function isLineTermsPublicToken(token: string): boolean {
  return PUBLIC_TOKEN_PATTERN.test(token);
}

export function lineTermsImagePath(token: string): string {
  if (!isLineTermsPublicToken(token)) throw new LineTermsImageError("CONFIG_INVALID", "invalid public token");
  return `/api/line/terms-image/${encodeURIComponent(token)}`;
}

type InstallmentSource = { installment_number: string };

export function resolveLineTermsPlanPosition(payment: InstallmentSource, legacySchedule?: InstallmentSource): "FIRST" | "LATER" | "UNKNOWN" {
  const value = payment.installment_number || legacySchedule?.installment_number || "";
  if (value === "1") return "FIRST";
  return /^[1-9]\d*$/.test(value) ? "LATER" : "UNKNOWN";
}

export function isFirstPlanPayment(payment: InstallmentSource, legacySchedule?: InstallmentSource): boolean {
  return resolveLineTermsPlanPosition(payment, legacySchedule) === "FIRST";
}
