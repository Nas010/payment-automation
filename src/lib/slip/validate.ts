export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export interface UploadCandidate {
  bytes: Uint8Array;
  declaredType: string;
  size: number;
}

export type UploadValidation = { ok: true; type: ImageType } | { ok: false; reason: string };

const MAX_BYTES = 10 * 1024 * 1024;

function detectedType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function validateImageUpload(candidate: UploadCandidate): Promise<UploadValidation> {
  if (!Number.isSafeInteger(candidate.size) || candidate.size <= 0 || candidate.size > MAX_BYTES) return { ok: false, reason: "Image must be between 1 byte and 10 MB" };
  const type = detectedType(candidate.bytes);
  if (!type) return { ok: false, reason: "Only JPEG, PNG, and WebP image files are accepted" };
  if (candidate.declaredType !== type) return { ok: false, reason: "File content does not match declared image type" };
  return { ok: true, type };
}
