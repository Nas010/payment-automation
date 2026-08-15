import type { LineLinkClaimResult } from "@/lib/sheets/clients";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentAuditInput } from "@/lib/sheets/payments";
import {
  createLineConnectionToken,
  createLineConnectionTokenFields,
  hashLineConnectionToken,
  LINE_CONNECTION_TOKEN_PATTERN,
} from "./connection-token";
import type { LineConnectionResult } from "./connection";
import {
  LINE_MESSAGE_TEST_SUBJECT_ID,
  type LineMessageTestProfile,
} from "./message-test-profile";

type ProfileUpdate = {
  expectedProfile: LineMessageTestProfile;
  profile: LineMessageTestProfile;
};

type ProfileClaim = ProfileUpdate & {
  tokenHash: string;
  lineUserId: string;
};

export type LineMessageTestConnectionDependencies = {
  getProfile: () => Promise<LineMessageTestProfile | null>;
  listClients: () => Promise<ClientRecord[]>;
  updateProfileIfUnchanged: (input: ProfileUpdate) => Promise<boolean>;
  claimConnection: (input: ProfileClaim) => Promise<LineLinkClaimResult>;
  disconnectConnection: (input: ProfileUpdate) => Promise<boolean>;
  appendAudit: (record: PaymentAuditInput) => Promise<void>;
  tokenGenerator?: () => string;
};

function nowIso(now: Date | string): string {
  return new Date(now).toISOString();
}

function sheetSafeDisplayName(displayName: string): string {
  return /^[=+\-@]/.test(displayName) ? `'${displayName}` : displayName;
}

function disconnectedProfile(profile: LineMessageTestProfile, now: Date | string): LineMessageTestProfile {
  return {
    ...profile,
    lineUserId: "",
    lineDisplayName: "",
    linePictureUrl: "",
    lineLinkStatus: "",
    lineLinkedAt: "",
    lineLinkError: "",
    lineLinkTokenHash: "",
    lineLinkTokenEncrypted: "",
    lineLinkTokenExpiresAt: "",
    updatedAt: nowIso(now),
  };
}

function testAudit(input: {
  action: string;
  previousStatus: string;
  newStatus: string;
  reason: string;
  lineUserId?: string;
}): PaymentAuditInput {
  return {
    paymentId: "",
    clientId: LINE_MESSAGE_TEST_SUBJECT_ID,
    action: input.action,
    previousStatus: input.previousStatus,
    newStatus: input.newStatus,
    reason: input.reason,
    source: input.action === "LINE_MESSAGE_TEST_LINKED" ? "LINE_CONNECT" : "LINE_TRAINER",
    metadata: JSON.stringify({
      subject: LINE_MESSAGE_TEST_SUBJECT_ID,
      status: input.newStatus,
      ...(input.lineUserId ? { lineUserSuffix: input.lineUserId.slice(-4) } : {}),
    }),
  };
}

async function markConflict(
  dependencies: LineMessageTestConnectionDependencies,
  profile: LineMessageTestProfile,
  now: Date | string,
  lineUserId: string,
): Promise<void> {
  const next = {
    ...profile,
    lineLinkStatus: "REVIEW" as const,
    lineLinkError: "LINE user conflict",
    updatedAt: nowIso(now),
  };
  if (!await dependencies.updateProfileIfUnchanged({ expectedProfile: profile, profile: next })) return;
  await dependencies.appendAudit(testAudit({
    action: "LINE_MESSAGE_TEST_CONFLICT",
    previousStatus: profile.lineLinkStatus,
    newStatus: "REVIEW",
    reason: "LINE user conflict",
    lineUserId,
  }));
}

export function createLineMessageTestConnectionService(dependencies: LineMessageTestConnectionDependencies) {
  return {
    async issue({ now }: { now: Date | string }): Promise<LineMessageTestProfile> {
      const current = await dependencies.getProfile();
      if (!current) throw new Error("LINE message test profile is required");

      let expected = current;
      if (current.lineUserId) {
        const cleared = disconnectedProfile(current, now);
        if (!await dependencies.disconnectConnection({ expectedProfile: current, profile: cleared })) {
          throw new Error("LINE message test profile changed before disconnect");
        }
        expected = cleared;
      }

      const fields = createLineConnectionTokenFields({
        clientId: LINE_MESSAGE_TEST_SUBJECT_ID,
        now,
        tokenGenerator: dependencies.tokenGenerator ?? createLineConnectionToken,
      });
      const issued: LineMessageTestProfile = {
        ...expected,
        lineLinkStatus: "LINK_ACTIVE",
        lineLinkedAt: "",
        lineLinkError: "",
        lineLinkTokenHash: fields.line_link_token_hash,
        lineLinkTokenEncrypted: fields.line_link_token_encrypted,
        lineLinkTokenExpiresAt: fields.line_link_token_expires_at,
        updatedAt: nowIso(now),
      };
      if (!await dependencies.updateProfileIfUnchanged({ expectedProfile: expected, profile: issued })) {
        throw new Error("LINE message test profile changed before connection issue");
      }
      await dependencies.appendAudit(testAudit({
        action: "LINE_MESSAGE_TEST_CONNECTION_CREATED",
        previousStatus: current.lineLinkStatus,
        newStatus: "LINK_ACTIVE",
        reason: "LINE message test connection created",
      }));
      return issued;
    },

    async claim(input: {
      token: string;
      lineUserId: string;
      displayName?: string;
      pictureUrl?: string;
      now: Date | string;
    }): Promise<LineConnectionResult> {
      if (!LINE_CONNECTION_TOKEN_PATTERN.test(input.token)) return "INVALID_OR_EXPIRED";
      const tokenHash = hashLineConnectionToken(input.token);
      const profile = await dependencies.getProfile();
      if (!profile || profile.lineLinkTokenHash !== tokenHash) return "INVALID_OR_EXPIRED";
      if (profile.lineUserId === input.lineUserId && profile.lineLinkStatus === "LINKED") return "ALREADY_LINKED";
      if (profile.lineUserId) {
        await markConflict(dependencies, profile, input.now, input.lineUserId);
        return "CONFLICT";
      }
      const expiry = new Date(profile.lineLinkTokenExpiresAt);
      if (profile.lineLinkStatus !== "LINK_ACTIVE"
        || !profile.lineLinkTokenEncrypted
        || Number.isNaN(expiry.getTime())
        || expiry.getTime() <= new Date(input.now).getTime()) {
        return "INVALID_OR_EXPIRED";
      }
      if ((await dependencies.listClients()).some((client) => client.line_user_id === input.lineUserId)) {
        await markConflict(dependencies, profile, input.now, input.lineUserId);
        return "CONFLICT";
      }

      const linked: LineMessageTestProfile = {
        ...profile,
        lineUserId: input.lineUserId,
        lineDisplayName: sheetSafeDisplayName(input.displayName ?? ""),
        linePictureUrl: input.pictureUrl ?? "",
        lineLinkStatus: "LINKED",
        lineLinkedAt: nowIso(input.now),
        lineLinkError: "",
        lineLinkTokenEncrypted: "",
        lineLinkTokenExpiresAt: "",
        updatedAt: nowIso(input.now),
      };
      const result = await dependencies.claimConnection({
        expectedProfile: profile,
        profile: linked,
        tokenHash,
        lineUserId: input.lineUserId,
      });
      if (result === "ALREADY_LINKED") return "ALREADY_LINKED";
      if (result === "CONFLICT") {
        const refreshed = await dependencies.getProfile();
        if (refreshed) await markConflict(dependencies, refreshed, input.now, input.lineUserId);
        return "CONFLICT";
      }
      if (result === "STALE") return "INVALID_OR_EXPIRED";
      await dependencies.appendAudit(testAudit({
        action: "LINE_MESSAGE_TEST_LINKED",
        previousStatus: profile.lineLinkStatus,
        newStatus: "LINKED",
        reason: "LINE message test account linked",
        lineUserId: input.lineUserId,
      }));
      return "LINKED";
    },

    async disconnect({ now }: { now: Date | string }): Promise<boolean> {
      const current = await dependencies.getProfile();
      if (!current) return false;
      const cleared = disconnectedProfile(current, now);
      if (!await dependencies.disconnectConnection({ expectedProfile: current, profile: cleared })) return false;
      await dependencies.appendAudit(testAudit({
        action: "LINE_MESSAGE_TEST_DISCONNECTED",
        previousStatus: current.lineLinkStatus,
        newStatus: "",
        reason: "LINE message test account disconnected",
      }));
      return true;
    },
  };
}
