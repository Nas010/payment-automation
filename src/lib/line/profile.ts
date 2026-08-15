const LINE_PROFILE_IMAGE_HOSTS = new Set(["profile.line-scdn.net", "obs.line-apps.com"]);

export type LineProfilePictureStatus = "present" | "missing" | "rejected";

export function normalizeLinePictureUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && LINE_PROFILE_IMAGE_HOSTS.has(url.hostname) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function lineProfilePictureStatus(value: unknown): LineProfilePictureStatus {
  if (typeof value !== "string" || value.length === 0) return "missing";
  return normalizeLinePictureUrl(value) ? "present" : "rejected";
}
