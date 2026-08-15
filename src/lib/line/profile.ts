const LINE_PROFILE_IMAGE_HOST = "profile.line-scdn.net";

export type LineProfilePictureStatus = "present" | "missing" | "rejected";

export function normalizeLinePictureUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === LINE_PROFILE_IMAGE_HOST ? url.toString() : "";
  } catch {
    return "";
  }
}

export function lineProfilePictureStatus(value: unknown): LineProfilePictureStatus {
  if (typeof value !== "string" || value.length === 0) return "missing";
  return normalizeLinePictureUrl(value) ? "present" : "rejected";
}
