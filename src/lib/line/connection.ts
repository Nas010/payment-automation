import type { ClientRecord, LineLinkClaimResult } from "@/lib/sheets/clients";
import {
  createLineConnectionToken,
  createLineConnectionTokenFields,
  hashLineConnectionToken,
  LINE_CONNECTION_TOKEN_PATTERN,
} from "./connection-token";

type AuditRecord = { paymentId: string; clientId: string; action: string; previousStatus: string; newStatus: string; reason: string; source: string; metadata?: string };

export type LineConnectionDependencies = {
  listClients: () => Promise<ClientRecord[]>;
  updateLineLinkClient: (input: { client: ClientRecord; expectedClient: ClientRecord; releaseLineUserId?: string }) => Promise<boolean>;
  claimLineConnection: (input: { client: ClientRecord; expectedClient: ClientRecord; tokenHash: string; lineUserId: string }) => Promise<LineLinkClaimResult>;
  appendAudit: (record: AuditRecord) => Promise<void>;
  tokenGenerator?: () => string;
};

export type LineConnectionResult = "LINKED" | "ALREADY_LINKED" | "INVALID_OR_EXPIRED" | "CLIENT_INACTIVE" | "CONFLICT";
export type GenerateMissingLineConnectionsResult = { created: string[]; alreadyActive: string[]; alreadyLinked: string[]; skippedInactive: string[]; failed: Array<{ clientId: string; error: string }> };
export type RenewLineConnectionResult = { clientId: string; status: "LINK_ACTIVE" } | null;

function nowIso(now: Date | string): string {
  return new Date(now).toISOString();
}

function isActiveClient(client: ClientRecord): boolean {
  return client.active.toUpperCase() === "TRUE";
}

function hasActiveConnection(client: ClientRecord, now: Date | string): boolean {
  const expiry = new Date(client.line_link_token_expires_at);
  return client.line_link_status === "LINK_ACTIVE"
    && /^[a-f0-9]{64}$/.test(client.line_link_token_hash)
    && Boolean(client.line_link_token_encrypted)
    && !Number.isNaN(expiry.getTime())
    && expiry.getTime() > new Date(now).getTime();
}

function sheetSafeDisplayName(displayName: string): string {
  return /^[=+\-@]/.test(displayName) ? `'${displayName}` : displayName;
}

function safeMetadata(client: ClientRecord, status: string, lineUserId?: string): string {
  return JSON.stringify({ clientId: client.client_id, status, ...(lineUserId ? { lineUserSuffix: lineUserId.slice(-4) } : {}) });
}

async function audit(dependencies: LineConnectionDependencies, input: { client: ClientRecord; action: string; previousStatus: string; newStatus: string; reason: string; source: "LINE_TRAINER" | "LINE_CONNECT"; lineUserId?: string }): Promise<void> {
  await dependencies.appendAudit({
    paymentId: "",
    clientId: input.client.client_id,
    action: input.action,
    previousStatus: input.previousStatus,
    newStatus: input.newStatus,
    reason: input.reason,
    source: input.source,
    metadata: safeMetadata(input.client, input.newStatus, input.lineUserId),
  });
}

function connectionFields(dependencies: LineConnectionDependencies, client: ClientRecord, now: Date | string): ClientRecord {
  return {
    ...client,
    line_link_code: "",
    line_link_code_expires_at: "",
    line_linked_at: "",
    line_link_message: "",
    line_link_error: "",
    ...createLineConnectionTokenFields({ clientId: client.client_id, now, tokenGenerator: dependencies.tokenGenerator ?? createLineConnectionToken }),
    updated_at: nowIso(now),
  };
}

async function markConflict(dependencies: LineConnectionDependencies, target: ClientRecord, now: Date | string, lineUserId: string): Promise<void> {
  const conflict = { ...target, line_link_status: "REVIEW", line_link_error: "LINE user conflict", updated_at: nowIso(now) };
  if (!await dependencies.updateLineLinkClient({ client: conflict, expectedClient: target })) return;
  await audit(dependencies, { client: target, action: "LINE_LINK_CONFLICT", previousStatus: target.line_link_status, newStatus: "REVIEW", reason: "LINE user conflict", source: "LINE_CONNECT", lineUserId });
}

export function createLineConnectionService(dependencies: LineConnectionDependencies): { claim(input: { token: string; lineUserId: string; displayName?: string; now: Date | string }): Promise<LineConnectionResult> } {
  return {
    async claim({ token, lineUserId, displayName = "", now }): Promise<LineConnectionResult> {
      if (!LINE_CONNECTION_TOKEN_PATTERN.test(token)) return "INVALID_OR_EXPIRED";
      const tokenHash = hashLineConnectionToken(token);
      const clients = await dependencies.listClients();
      const target = clients.find((client) => client.line_link_token_hash === tokenHash);
      if (!target) return "INVALID_OR_EXPIRED";
      if (target.line_user_id === lineUserId) return "ALREADY_LINKED";
      if (!isActiveClient(target)) return "CLIENT_INACTIVE";
      if (target.line_user_id) {
        await markConflict(dependencies, target, now, lineUserId);
        return "CONFLICT";
      }
      if (!hasActiveConnection(target, now)) return "INVALID_OR_EXPIRED";
      if (clients.some((client) => client.client_id !== target.client_id && client.line_user_id === lineUserId)) {
        await markConflict(dependencies, target, now, lineUserId);
        return "CONFLICT";
      }

      const linked: ClientRecord = {
        ...target,
        line_user_id: lineUserId,
        line_display_name: sheetSafeDisplayName(displayName),
        line_link_status: "LINKED",
        line_linked_at: nowIso(now),
        line_link_error: "",
        line_link_token_encrypted: "",
        line_link_token_expires_at: "",
        updated_at: nowIso(now),
      };
      const result = await dependencies.claimLineConnection({ client: linked, expectedClient: target, tokenHash, lineUserId });
      if (result === "ALREADY_LINKED") return "ALREADY_LINKED";
      if (result === "CONFLICT") {
        const currentTarget = (await dependencies.listClients()).find((client) => client.line_link_token_hash === tokenHash);
        if (currentTarget) await markConflict(dependencies, currentTarget, now, lineUserId);
        return "CONFLICT";
      }
      if (result === "STALE") return "INVALID_OR_EXPIRED";
      await audit(dependencies, { client: target, action: "LINE_LINK_LINKED", previousStatus: target.line_link_status, newStatus: "LINKED", reason: "LINE account linked", source: "LINE_CONNECT", lineUserId });
      return "LINKED";
    },
  };
}

export async function generateMissingLineConnections(dependencies: LineConnectionDependencies, { now }: { now: Date | string }): Promise<GenerateMissingLineConnectionsResult> {
  const clients = await dependencies.listClients();
  const result: GenerateMissingLineConnectionsResult = { created: [], alreadyActive: [], alreadyLinked: [], skippedInactive: [], failed: [] };
  for (const client of clients) {
    if (!isActiveClient(client)) {
      result.skippedInactive.push(client.client_id);
    } else if (client.line_user_id) {
      result.alreadyLinked.push(client.client_id);
    } else if (hasActiveConnection(client, now)) {
      result.alreadyActive.push(client.client_id);
    } else {
      try {
        const updated = connectionFields(dependencies, client, now);
        if (!await dependencies.updateLineLinkClient({ client: updated, expectedClient: client })) throw new Error("Client changed before LINE connection update");
        await audit(dependencies, { client, action: "LINE_CONNECTION_CREATED", previousStatus: client.line_link_status, newStatus: "LINK_ACTIVE", reason: "LINE connection created", source: "LINE_TRAINER" });
        result.created.push(client.client_id);
      } catch (error) {
        result.failed.push({ clientId: client.client_id, error: error instanceof Error ? error.message : "LINE connection generation failed" });
      }
    }
  }
  return result;
}

export async function renewLineConnection(dependencies: LineConnectionDependencies, { clientId, now }: { clientId: string; now: Date | string }): Promise<RenewLineConnectionResult> {
  const client = (await dependencies.listClients()).find((item) => item.client_id === clientId);
  if (!client || !isActiveClient(client) || client.line_user_id) return null;
  const updated = connectionFields(dependencies, client, now);
  if (!await dependencies.updateLineLinkClient({ client: updated, expectedClient: client })) return null;
  await audit(dependencies, { client, action: "LINE_CONNECTION_RENEWED", previousStatus: client.line_link_status, newStatus: "LINK_ACTIVE", reason: "LINE connection renewed", source: "LINE_TRAINER" });
  return { clientId, status: "LINK_ACTIVE" };
}
