import { findLineTermsImageByPublicToken, isLineTermsPublicToken, validateLineTermsImageBytes } from "@/lib/line/terms-image";
import { getLineTermsImageState } from "@/lib/sheets/settings";
import { readDriveTermsImageFile } from "@/lib/storage/drive-client";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ publicToken: string }> }): Promise<Response> {
  const { publicToken } = await params;
  if (!isLineTermsPublicToken(publicToken)) return new Response("Not Found", { status: 404 });
  try {
    const version = findLineTermsImageByPublicToken(await getLineTermsImageState(), publicToken);
    if (!version) return new Response("Not Found", { status: 404 });
    const file = await readDriveTermsImageFile(version.driveFileId);
    const detectedMimeType = validateLineTermsImageBytes(file.bytes);
    if (detectedMimeType !== version.mimeType || file.bytes.byteLength !== version.byteLength) {
      return new Response("Service Unavailable", { status: 503 });
    }
    const body = new ArrayBuffer(file.bytes.byteLength);
    new Uint8Array(body).set(file.bytes);
    return new Response(body, { headers: {
      "Content-Type": detectedMimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("Service Unavailable", { status: 503 });
  }
}
