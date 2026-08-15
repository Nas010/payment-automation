import type { ClientRecord } from "@/lib/sheets/clients";
import { buildLineConnectUrl, recoverLineConnectionToken } from "./connection-token";
import { renderLineWelcomeTemplate } from "./message-template";

/** Renders current global template only while a recoverable connection is active. */
export function renderClientLineWelcomeMessage({ client, template, businessName, liffId, now = new Date() }: { client: ClientRecord; template: string; businessName: string; liffId: string; now?: Date | string }): string | null {
  const expiry = new Date(client.line_link_token_expires_at);
  if (client.line_user_id || client.line_link_status !== "LINK_ACTIVE" || !client.line_link_token_encrypted || Number.isNaN(expiry.getTime()) || expiry.getTime() <= new Date(now).getTime()) return null;
  try {
    const token = recoverLineConnectionToken({ clientId: client.client_id, encryptedToken: client.line_link_token_encrypted });
    return renderLineWelcomeTemplate(template, {
      client_name: client.client_name,
      business_name: businessName,
      line_connect_url: buildLineConnectUrl({ liffId, token }),
    });
  } catch {
    return null;
  }
}
