import type { LineCredentialMetadata } from "@/components/admin/line-integration-form";
import type { getSecretMetadata } from "@/lib/secrets/service";

export function lineCredentialMetadata(records: Awaited<ReturnType<typeof getSecretMetadata>>): LineCredentialMetadata[] {
  return (["line_channel_access_token", "line_channel_secret"] as const).map((keyName) => {
    const encrypted = records.find((record) => record.keyName === keyName);
    return encrypted
      ? { keyName, configured: true, source: "encrypted" as const, lastFour: encrypted.lastFour, updatedAt: encrypted.updatedAt }
      : { keyName, configured: false, source: "unconfigured" as const };
  });
}

export function validationMetadata(value: string | undefined): { status: "VALID" | "FAILED"; validatedAt: string } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { status?: unknown; validatedAt?: unknown };
    if ((parsed.status === "VALID" || parsed.status === "FAILED") && typeof parsed.validatedAt === "string") return { status: parsed.status, validatedAt: parsed.validatedAt };
  } catch {}
  return undefined;
}
