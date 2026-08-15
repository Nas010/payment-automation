const LINE_PROFILE_IMAGE_HOST = "profile.line-scdn.net";

export function normalizeLinePictureUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === LINE_PROFILE_IMAGE_HOST ? url.toString() : "";
  } catch {
    return "";
  }
}
