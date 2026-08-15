import type { ClientRecord, LineConnectionClaimResult } from "@/lib/sheets/clients";
import type { LineMessageTestProfile } from "./message-test-profile";
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
  claimLineConnection: (input: { client: ClientRecord; expectedClient: ClientRecord; tokenHash: string; lineUserId: string }) => Promise<LineConnectionClaimResult>;
  appendAudit: (record: AuditRecord) => Promise<void>;
  tokenGenerator?: () => string;
};

export type LineConnectionResult =
  | { status: "LINKED" | "ALREADY_LINKED"; clientId: string }
  | { status: "INVALID_OR_EXPIRED" | "CLIENT_INACTIVE" | "CONFLICT" };
export type GenerateMissingLineConnectionsResult = { created: string[]; alreadyActive: string[]; alreadyLinked: string[]; skippedInactive: string[]; failed: Array<{ clientId: string; error: string }> };
export type RenewLineConnectionResult = { clientId: string; status: "LINK_ACTIVE" } | null;
export type LineConnectionScope = "CLIENT" | "TEST" | "INVALID";

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

function hasRoutableClientToken(client: ClientRecord, now: Date | string): boolean {
  return hasActiveConnection(client, now)
    || (client.line_link_status === "LINKED" && Boolean(client.line_user_id));
}

function hasRoutableTestToken(profile: LineMessageTestProfile, now: Date | string): boolean {
  if (profile.lineLinkStatus === "LINKED" && profile.lineUserId) return true;
  const expiry = new Date(profile.lineLinkTokenExpiresAt);
  return profile.lineLinkStatus === "LINK_ACTIVE"
    && Boolean(profile.lineLinkTokenEncrypted)
    && !Number.isNaN(expiry.getTime())
    && expiry.getTime() > new Date(now).getTime();
}

export function resolveLineConnectionScope(input: {
  token: string;
  now: Date | string;
  clients: readonly ClientRecord[];
  testProfile: LineMessageTestProfile | null;
}): LineConnectionScope {
  if (!LINE_CONNECTION_TOKEN_PATTERN.test(input.token)) return "INVALID";
  const tokenHash = hashLineConnectionToken(input.token);
  const clientMatches = input.clients.filter((client) => (
    client.line_link_token_hash === tokenHash && hasRoutableClientToken(client, input.now)
  )).length;
  const testMatches = input.testProfile?.lineLinkTokenHash === tokenHash
    && hasRoutableTestToken(input.testProfile, input.now)
    ? 1
    : 0;
  if (clientMatches + testMatches !== 1) return "INVALID";
  return clientMatches === 1 ? "CLIENT" : "TEST";
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
    line_linked_at: "",
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

export function createLineConnectionService(dependencies: LineConnectionDependencies): { claim(input: { token: string; lineUserId: string; displayName?: string; pictureUrl?: string; now: Date | string }): Promise<LineConnectionResult> } {
  return {
    async claim({ token, lineUserId, displayName = "", pictureUrl = "", now }): Promise<LineConnectionResult> {
      if (!LINE_CONNECTION_TOKEN_PATTERN.test(token)) return { status: "INVALID_OR_EXPIRED" };
      const tokenHash = hashLineConnectionToken(token);
      const clients = await dependencies.listClients();
      const target = clients.find((client) => client.line_link_token_hash === tokenHash);
      if (!target) return { status: "INVALID_OR_EXPIRED" };
      if (!isActiveClient(target)) return { status: "CLIENT_INACTIVE" };
      if (target.line_user_id === lineUserId) {
        await dependencies.updateLineLinkClient({
          client: { ...target, line_display_name: sheetSafeDisplayName(displayName), line_picture_url: pictureUrl, updated_at: nowIso(now) },
          expectedClient: target,
        });
        return { status: "ALREADY_LINKED", clientId: target.client_id };
      }
      if (target.line_user_id) {
        await markConflict(dependencies, target, now, lineUserId);
        return { status: "CONFLICT" };
      }
      if (!hasActiveConnection(target, now)) return { status: "INVALID_OR_EXPIRED" };
      if (clients.some((client) => client.client_id !== target.client_id && client.line_user_id === lineUserId)) {
        await markConflict(dependencies, target, now, lineUserId);
        return { status: "CONFLICT" };
      }

      const linked: ClientRecord = {
        ...target,
        line_user_id: lineUserId,
        line_display_name: sheetSafeDisplayName(displayName),
        line_picture_url: pictureUrl,
        line_link_status: "LINKED",
        line_linked_at: nowIso(now),
        line_link_error: "",
        line_link_token_encrypted: "",
        line_link_token_expires_at: "",
        updated_at: nowIso(now),
      };
      const result = await dependencies.claimLineConnection({ client: linked, expectedClient: target, tokenHash, lineUserId });
      if (result === "ALREADY_LINKED") return { status: "ALREADY_LINKED", clientId: target.client_id };
      if (result === "CONFLICT") {
        const currentTarget = (await dependencies.listClients()).find((client) => client.line_link_token_hash === tokenHash);
        if (currentTarget) await markConflict(dependencies, currentTarget, now, lineUserId);
        return { status: "CONFLICT" };
      }
      if (result === "STALE") return { status: "INVALID_OR_EXPIRED" };
      await audit(dependencies, { client: target, action: "LINE_LINK_LINKED", previousStatus: target.line_link_status, newStatus: "LINKED", reason: "LINE account linked", source: "LINE_CONNECT", lineUserId });
      return { status: "LINKED", clientId: target.client_id };
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

export async function disconnectLineUser(dependencies: LineConnectionDependencies, { clientId, now }: { clientId: string; now: Date | string }): Promise<boolean> {
  const client = (await dependencies.listClients()).find((item) => item.client_id === clientId);
  if (!client) return false;
  const updated: ClientRecord = {
    ...client,
    line_user_id: "",
    line_display_name: "",
    line_picture_url: "",
    line_link_status: "",
    line_linked_at: "",
    line_link_error: "",
    line_link_token_hash: "",
    line_link_token_encrypted: "",
    line_link_token_expires_at: "",
    updated_at: nowIso(now),
  };
  if (!await dependencies.updateLineLinkClient({ client: updated, expectedClient: client, releaseLineUserId: client.line_user_id })) return false;
  await audit(dependencies, { client, action: "LINE_LINK_DISCONNECTED", previousStatus: client.line_link_status, newStatus: "", reason: "LINE account disconnected", source: "LINE_TRAINER", lineUserId: client.line_user_id });
  return true;
}
