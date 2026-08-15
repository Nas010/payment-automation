"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { LineTermsImageError } from "@/lib/line/terms-image";
import { uploadLineTermsImage } from "@/lib/line/terms-image-upload";
import { appendAudit } from "@/lib/sheets/payments";

export type LineTermsImageActionResult = { ok: boolean; status: "SAVED" | "FAILED"; message: string };

export async function uploadLineTermsImageAction(formData: FormData): Promise<LineTermsImageActionResult> {
  await requireAdmin();
  const file = formData.get("terms_image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, status: "FAILED", message: "Choose a JPEG or PNG image." };
  }
  try {
    const version = await uploadLineTermsImage({ bytes: new Uint8Array(await file.arrayBuffer()), originalName: file.name });
    await appendAudit({
      paymentId: "",
      clientId: "",
      action: "LINE_TERMS_IMAGE_SAVED",
      previousStatus: "line_terms_image_active_version",
      newStatus: version.versionId,
      reason: "LINE T&S image updated",
      source: "ADMIN",
      metadata: JSON.stringify({ versionId: version.versionId, mimeType: version.mimeType, byteLength: version.byteLength }),
    });
    revalidatePath("/admin/settings");
    return { ok: true, status: "SAVED", message: "T&S image saved." };
  } catch (error) {
    const message = error instanceof LineTermsImageError ? error.message : "Could not save T&S image. Try again.";
    return { ok: false, status: "FAILED", message };
  }
}
