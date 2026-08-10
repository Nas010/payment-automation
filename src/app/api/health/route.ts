import { requiredConfiguration } from "@/lib/config";

export async function GET(): Promise<Response> {
  const missing = requiredConfiguration();
  return Response.json({ ok: true, status: missing.length ? "needs_configuration" : "ready", missing });
}
