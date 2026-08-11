import { getPaymentById } from "@/lib/sheets/payments";
import { requireAdmin } from "@/lib/admin-auth";
import { getConfiguredDriveClient } from "@/lib/storage/drive-client";

export const runtime = "nodejs";

function driveId(url: string): string | null { return url.match(/[?&]id=([^&]+)/)?.[1] ?? url.match(/\/d\/([^/]+)/)?.[1] ?? null; }

export async function GET(_request: Request, { params }: { params: Promise<{ paymentId: string }> }): Promise<Response> {
  await requireAdmin();
  const { paymentId } = await params;
  const payment = await getPaymentById(paymentId);
  const fileId = payment?.slip_url ? driveId(payment.slip_url) : null;
  if (!fileId) return Response.json({ error: "Private slip not available" }, { status: 404 });
  try {
    const drive = await getConfiguredDriveClient();
    const file = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true });
    return new Response(file.data as ArrayBuffer, { headers: { "Content-Type": file.headers?.["content-type"] ?? "image/jpeg", "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Private slip not available" }, { status: 404 });
  }
}
