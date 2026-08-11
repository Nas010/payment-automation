import { requiredConfiguration } from "@/lib/config";
import { getSlipStorageFolder } from "@/lib/storage/drive-folder";

export async function GET(): Promise<Response> {
  const missing = requiredConfiguration();
  if (missing.length === 0) {
    try {
      await getSlipStorageFolder();
    } catch {
      missing.push("SLIP_STORAGE_FOLDER_ID");
    }
  }
  return Response.json({ ok: true, status: missing.length ? "needs_configuration" : "ready", missing });
}
