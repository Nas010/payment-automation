import { google } from "googleapis";
import { getPaymentById } from "@/lib/sheets/payments";
import { requireAdmin } from "@/lib/admin-auth";
import { serverConfig } from "@/lib/config";

export const runtime = "nodejs";

function driveId(url: string): string | null { return url.match(/[?&]id=([^&]+)/)?.[1] ?? url.match(/\/d\/([^/]+)/)?.[1] ?? null; }

export async function GET(_request: Request, { params }: { params: Promise<{ paymentId: string }> }): Promise<Response> {
  await requireAdmin();
  const { paymentId } = await params;
  const payment = await getPaymentById(paymentId);
  const fileId = payment?.slip_url ? driveId(payment.slip_url) : null;
  if (!fileId) return Response.json({ error: "Private slip not available" }, { status: 404 });
  const config = serverConfig();
  const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(config.serviceAccountJson) as Record<string, string>, scopes: ["https://www.googleapis.com/auth/drive.file"] });
  const drive = google.drive({ version: "v3", auth });
  const file = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return new Response(file.data as ArrayBuffer, { headers: { "Content-Type": file.headers["content-type"] ?? "image/jpeg", "Cache-Control": "private, no-store" } });
}
