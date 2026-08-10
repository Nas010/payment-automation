import { lineConfig } from "@/lib/config";
import { appendAudit } from "@/lib/sheets/payments";
import { decryptSecret, encryptSecret } from "./crypto";
import { getSecretRecord, listSecretMetadata, upsertSecretRecord } from "./repository";
import type { SecretKeyName, SecretMetadata } from "./types";

function configuredValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "CONFIG_REQUIRED" ? trimmed : null;
}

export async function getSecret(keyName: SecretKeyName): Promise<string | null> {
  const record = await getSecretRecord(keyName);
  return record ? decryptSecret({ keyName, record }) : null;
}

export async function setSecret({ keyName, plaintext }: { keyName: SecretKeyName; plaintext: string }): Promise<void> {
  if (!plaintext.trim()) throw new Error("Secret value is required");
  await upsertSecretRecord({ keyName, ...encryptSecret({ keyName, plaintext }) });
  await appendAudit({
    paymentId: "",
    clientId: "",
    action: "INTEGRATION_SECRET_UPDATED",
    previousStatus: "",
    newStatus: "",
    reason: "Encrypted integration secret updated",
    source: "ADMIN",
    metadata: JSON.stringify({ keyName }),
  });
}

export async function getSecretMetadata(): Promise<SecretMetadata[]> {
  return listSecretMetadata();
}

export async function getLineChannelAccessToken(environment: Record<string, string | undefined> = process.env): Promise<string> {
  const encrypted = await getSecret("line_channel_access_token");
  const value = encrypted ?? configuredValue(lineConfig(environment).channelAccessToken);
  if (!value) throw new Error("LINE channel access token is not configured");
  return value;
}

export async function getLineChannelSecret(environment: Record<string, string | undefined> = process.env): Promise<string> {
  const encrypted = await getSecret("line_channel_secret");
  const value = encrypted ?? configuredValue(lineConfig(environment).channelSecret);
  if (!value) throw new Error("LINE channel secret is not configured");
  return value;
}

export async function getLineCredentials(environment: Record<string, string | undefined> = process.env): Promise<{ channelAccessToken: string; channelSecret: string }> {
  const [channelAccessToken, channelSecret] = await Promise.all([getLineChannelAccessToken(environment), getLineChannelSecret(environment)]);
  return { channelAccessToken, channelSecret };
}
