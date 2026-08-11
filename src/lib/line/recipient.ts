import type { ClientRecord } from "@/lib/sheets/clients";

const lineUserIdPattern = /^U[0-9a-f]{32}$/;

/** True only when a client is eligible for a direct due-payment LINE push. */
export function isLinkedLinePaymentRecipient(client: ClientRecord | undefined): client is ClientRecord {
  if (!client) return false;
  return client.active.trim().toUpperCase() === "TRUE"
    && client.line_link_status.trim().toUpperCase() === "LINKED"
    && lineUserIdPattern.test(client.line_user_id);
}
