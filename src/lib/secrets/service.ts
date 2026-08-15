import "./server-only";
import { appendAudit } from "@/lib/sheets/payments";
import { decryptSecret, encryptSecret } from "./crypto";
import { getSecretRecord, listSecretMetadata, upsertSecretRecord } from "./repository";
import type { LineSecretKeyName, SecretKeyName, SecretMetadata } from "./types";

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

export async function getLineChannelAccessToken(): Promise<string> {
  const encrypted = await getSecret("line_channel_access_token");
  if (!encrypted) throw new Error("LINE channel access token is not configured");
  return validateCredential("line_channel_access_token", encrypted);
}

export async function getLineChannelSecret(): Promise<string> {
  const encrypted = await getSecret("line_channel_secret");
  if (!encrypted) throw new Error("LINE channel secret is not configured");
  return validateCredential("line_channel_secret", encrypted);
}

export async function getLineCredentials(): Promise<{ channelAccessToken: string; channelSecret: string }> {
  const channelAccessToken = await getLineChannelAccessToken();
  const channelSecret = await getLineChannelSecret();
  return { channelAccessToken, channelSecret };
}
