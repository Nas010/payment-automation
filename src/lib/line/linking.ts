import type { ClientRecord } from "@/lib/sheets/clients";
import { createLineLinkCode, expiresAt, normalizeLineLinkCode } from "./link-code";
import { renderLineLinkInstruction } from "./link-message";

type AuditRecord = { paymentId: string; clientId: string; action: string; previousStatus: string; newStatus: string; reason: string; source: string; metadata?: string };

export type LineLinkDependencies = {
  listClients: () => Promise<ClientRecord[]>;
  updateClient: (client: ClientRecord) => Promise<void>;
  updateLineLinkClient: (input: { client: ClientRecord; expectedClient: ClientRecord; releaseLineUserId?: string }) => Promise<boolean>;
  appendAudit: (record: AuditRecord) => Promise<void>;
  codeGenerator?: () => string;
};

export type LineLinkServiceDependencies = LineLinkDependencies & {
  claimLineLink: (input: { client: ClientRecord; expectedClient: ClientRecord; code: string; lineUserId: string }) => Promise<"CLAIMED" | "ALREADY_LINKED" | "CONFLICT" | "STALE">;
};

type LineLinkInput = { code: string; lineUserId: string; now: Date | string; webhookEventId: string };
type TrainerInput = { now: Date | string };
type ClientTrainerInput = TrainerInput & { clientId: string };
export type LinkResult = "LINKED" | "ALREADY_LINKED" | "INVALID_OR_EXPIRED" | "CLIENT_INACTIVE" | "CONFLICT";

function nowIso(now: Date | string): string {
  return new Date(now).toISOString();
}

function isActiveClient(client: ClientRecord): boolean {
  return client.active.toUpperCase() === "TRUE";
}

function hasUnexpiredCode(client: ClientRecord, now: Date | string): boolean {
  const expiry = new Date(client.line_link_code_expires_at);
  return Boolean(normalizeLineLinkCode(client.line_link_code)) && !Number.isNaN(expiry.getTime()) && expiry.getTime() > new Date(now).getTime();
}

function hasActiveCode(client: ClientRecord, now: Date | string): boolean {
  return client.line_link_status === "CODE_ACTIVE" && hasUnexpiredCode(client, now);
}

function maskedLineUserSuffix(lineUserId: string): string {
  return lineUserId.slice(-4);
}

function sheetSafeLineDisplayName(displayName: string): string {
  return /^[=+\-@]/.test(displayName) ? `'${displayName}` : displayName;
}

function safeMetadata({ clientId, status, webhookEventId, lineUserId }: { clientId: string; status: string; webhookEventId?: string; lineUserId?: string }): string {
  return JSON.stringify({
    clientId,
    status,
    ...(webhookEventId ? { webhookEventId } : {}),
    ...(lineUserId ? { lineUserSuffix: maskedLineUserSuffix(lineUserId) } : {}),
  });
}

async function audit(dependencies: LineLinkDependencies, input: { client: ClientRecord; action: string; previousStatus: string; newStatus: string; reason: string; webhookEventId?: string; lineUserId?: string }): Promise<void> {
  await dependencies.appendAudit({
    paymentId: "",
    clientId: input.client.client_id,
    action: input.action,
    previousStatus: input.previousStatus,
    newStatus: input.newStatus,
    reason: input.reason,
    source: input.webhookEventId ? "LINE_WEBHOOK" : "LINE_TRAINER",
    metadata: safeMetadata({ clientId: input.client.client_id, status: input.newStatus, webhookEventId: input.webhookEventId, lineUserId: input.lineUserId }),
  });
}

function usedCodes(clients: readonly ClientRecord[]): Set<string> {
  return new Set(clients.map((client) => normalizeLineLinkCode(client.line_link_code)).filter((code): code is string => Boolean(code)));
}

function nextUniqueCode(dependencies: LineLinkDependencies, codes: Set<string>): string {
  const generate = dependencies.codeGenerator ?? createLineLinkCode;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = normalizeLineLinkCode(generate());
    if (code && !codes.has(code)) {
      codes.add(code);
      return code;
    }
  }
  throw new Error("Unable to generate a unique LINE link code");
}

function codeFields(client: ClientRecord, code: string, now: Date | string): ClientRecord {
  return {
    ...client,
    line_link_code: code,
    line_link_code_expires_at: expiresAt(now),
    line_link_status: "CODE_ACTIVE",
    line_linked_at: "",
    line_link_message: renderLineLinkInstruction({ clientName: client.client_name, code }),
    line_link_error: "",
    updated_at: nowIso(now),
  };
}

export function createLineLinkService(dependencies: LineLinkServiceDependencies): { linkLineUser(input: LineLinkInput): Promise<LinkResult>; persistLineDisplayName(input: { lineUserId: string; displayName: string; now: Date | string }): Promise<boolean> } {
  return {
    async linkLineUser({ code, lineUserId, now, webhookEventId }: LineLinkInput): Promise<LinkResult> {
      const clients = await dependencies.listClients();
      const normalizedCode = normalizeLineLinkCode(code);
      if (!normalizedCode) return clients.some((client) => client.line_user_id === lineUserId) ? "ALREADY_LINKED" : "INVALID_OR_EXPIRED";
      const target = clients.find((client) => normalizeLineLinkCode(client.line_link_code) === normalizedCode && hasActiveCode(client, now));
      if (!target) return clients.some((client) => client.line_user_id === lineUserId) ? "ALREADY_LINKED" : "INVALID_OR_EXPIRED";
      if (!isActiveClient(target)) return "CLIENT_INACTIVE";

      if (target.line_user_id === lineUserId) return "ALREADY_LINKED";

      if (target.line_user_id || clients.some((client) => client.client_id !== target.client_id && client.line_user_id === lineUserId)) {
        const conflict = { ...target, line_link_status: "REVIEW", line_link_error: "LINE user conflict", updated_at: nowIso(now) };
        if (!await dependencies.updateLineLinkClient({ client: conflict, expectedClient: target })) return "CONFLICT";
        await audit(dependencies, { client: target, action: "LINE_LINK_CONFLICT", previousStatus: target.line_link_status, newStatus: "REVIEW", reason: "LINE user conflict", webhookEventId, lineUserId });
        return "CONFLICT";
      }

      const linked = {
        ...target,
        line_user_id: lineUserId,
        line_link_code: "",
        line_link_code_expires_at: "",
        line_link_status: "LINKED",
        line_linked_at: nowIso(now),
        line_link_message: "",
        line_link_error: "",
        line_link_token_hash: "",
        line_link_token_encrypted: "",
        line_link_token_expires_at: "",
        updated_at: nowIso(now),
      };
      const claimResult = await dependencies.claimLineLink({ client: linked, expectedClient: target, code: normalizedCode, lineUserId });
      if (claimResult === "ALREADY_LINKED") return "ALREADY_LINKED";
      if (claimResult === "CONFLICT") return "CONFLICT";
      if (claimResult === "STALE") return "INVALID_OR_EXPIRED";
      await audit(dependencies, { client: target, action: "LINE_LINK_LINKED", previousStatus: target.line_link_status, newStatus: "LINKED", reason: "LINE account linked", webhookEventId, lineUserId });
      return "LINKED";
    },
    async persistLineDisplayName({ lineUserId, displayName, now }: { lineUserId: string; displayName: string; now: Date | string }): Promise<boolean> {
      const client = (await dependencies.listClients()).find((item) => item.line_user_id === lineUserId && item.line_link_status === "LINKED");
      if (!client) return false;
      return dependencies.updateLineLinkClient({ client: { ...client, line_display_name: sheetSafeLineDisplayName(displayName), updated_at: nowIso(now) }, expectedClient: client });
    },
  };
}

export type GenerateMissingLineLinkCodesResult = { created: string[]; alreadyActive: string[]; alreadyLinked: string[]; skippedInactive: string[]; failed: Array<{ clientId: string; error: string }> };

export async function generateMissingLineLinkCodes(dependencies: LineLinkDependencies, { now }: TrainerInput): Promise<GenerateMissingLineLinkCodesResult> {
  const clients = await dependencies.listClients();
  const result: GenerateMissingLineLinkCodesResult = { created: [], alreadyActive: [], alreadyLinked: [], skippedInactive: [], failed: [] };
  const codes = usedCodes(clients);

  for (const client of clients) {
    if (!isActiveClient(client)) {
      result.skippedInactive.push(client.client_id);
      continue;
    }
    if (client.line_user_id) {
      result.alreadyLinked.push(client.client_id);
      continue;
    }
    if (hasUnexpiredCode(client, now)) {
      result.alreadyActive.push(client.client_id);
      continue;
    }
    try {
      const updated = codeFields(client, nextUniqueCode(dependencies, codes), now);
      if (!await dependencies.updateLineLinkClient({ client: updated, expectedClient: client })) throw new Error("Client changed before LINE link code update");
      await audit(dependencies, { client, action: "LINE_LINK_CODE_CREATED", previousStatus: client.line_link_status, newStatus: "CODE_ACTIVE", reason: "LINE link code created" });
      result.created.push(client.client_id);
    } catch (error) {
      result.failed.push({ clientId: client.client_id, error: error instanceof Error ? error.message : "LINE link code generation failed" });
    }
  }
  return result;
}

export type RenewLineLinkCodeResult = { clientId: string; code: string; status: "CODE_ACTIVE" } | null;

export async function renewLineLinkCode(dependencies: LineLinkDependencies, { clientId, now }: ClientTrainerInput): Promise<RenewLineLinkCodeResult> {
  const clients = await dependencies.listClients();
  const client = clients.find((item) => item.client_id === clientId);
  if (!client || !isActiveClient(client) || client.line_user_id) return null;
  const updated = codeFields(client, nextUniqueCode(dependencies, usedCodes(clients)), now);
  if (!await dependencies.updateLineLinkClient({ client: updated, expectedClient: client })) return null;
  await audit(dependencies, { client, action: "LINE_LINK_CODE_RENEWED", previousStatus: client.line_link_status, newStatus: "CODE_ACTIVE", reason: "LINE link code renewed" });
  return { clientId, code: updated.line_link_code, status: "CODE_ACTIVE" };
}

export async function disconnectLineUser(dependencies: LineLinkDependencies, { clientId, now }: ClientTrainerInput): Promise<boolean> {
  const client = (await dependencies.listClients()).find((item) => item.client_id === clientId);
  if (!client) return false;
  const updated = { ...client, line_user_id: "", line_display_name: "", line_link_code: "", line_link_code_expires_at: "", line_link_status: "", line_linked_at: "", line_link_message: "", line_link_error: "", line_link_token_hash: "", line_link_token_encrypted: "", line_link_token_expires_at: "", updated_at: nowIso(now) };
  if (!await dependencies.updateLineLinkClient({ client: updated, expectedClient: client, releaseLineUserId: client.line_user_id })) return false;
  await audit(dependencies, { client, action: "LINE_LINK_DISCONNECTED", previousStatus: client.line_link_status, newStatus: "", reason: "LINE account disconnected", lineUserId: client.line_user_id });
  return true;
}
