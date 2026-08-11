import "./server-only";
import { lineConfig } from "@/lib/config";
import { appendAudit } from "@/lib/sheets/payments";
import { decryptSecret, encryptSecret } from "./crypto";
import { getSecretRecord, listSecretMetadata, upsertSecretRecord } from "./repository";
import type { LineSecretKeyName, SecretKeyName, SecretMetadata } from "./types";

function configuredValue(value: string | undefined): string | null {
  return value && value !== "CONFIG_REQUIRED" ? value : null;
}

function credentialLabel(keyName: LineSecretKeyName): string {
  return keyName === "line_channel_access_token" ? "LINE channel access token" : "LINE channel secret";
}

/** LINE access tokens must be non-blank, at least 20 characters, and contain no whitespace/control characters. Channel secrets are exactly 32 ASCII alphanumeric characters. */
function validateCredential(keyName: LineSecretKeyName, value: string): string {
  const hasWhitespaceOrControl = /[\s\x00-\x1F\x7F]/.test(value);
  const valid = keyName === "line_channel_access_token"
    ? value.length >= 20 && !hasWhitespaceOrControl
    : /^[A-Za-z0-9]{32}$/.test(value) && !hasWhitespaceOrControl;
  if (!valid) throw new Error(`${credentialLabel(keyName)} is malformed`);
  return value;
}

export async function getSecret(keyName: SecretKeyName): Promise<string | null> {
  const record = await getSecretRecord(keyName);
  return record ? decryptSecret({ keyName, record }) : null;
}

export async function setSecret({ keyName, plaintext }: { keyName: LineSecretKeyName; plaintext: string }): Promise<void> {
  validateCredential(keyName, plaintext);
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
  return validateCredential("line_channel_access_token", value);
}

export async function getLineChannelSecret(environment: Record<string, string | undefined> = process.env): Promise<string> {
  const encrypted = await getSecret("line_channel_secret");
  const value = encrypted ?? configuredValue(lineConfig(environment).channelSecret);
  if (!value) throw new Error("LINE channel secret is not configured");
  return validateCredential("line_channel_secret", value);
}

export async function getLineCredentials(environment: Record<string, string | undefined> = process.env): Promise<{ channelAccessToken: string; channelSecret: string }> {
  const channelAccessToken = await getLineChannelAccessToken(environment);
  const channelSecret = await getLineChannelSecret(environment);
  return { channelAccessToken, channelSecret };
}
