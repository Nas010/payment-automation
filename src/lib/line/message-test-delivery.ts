import { randomUUID } from "node:crypto";

import { getLineChannelAccessToken } from "@/lib/secrets/service";
import { appendAudit, type PaymentAuditInput } from "@/lib/sheets/payments";
import { getLineMessageTestProfile } from "@/lib/sheets/line-message-test-profile";
import { getLineDueMessageProfiles, getLineInstallmentReminderConfig, getLineTermsImageState } from "@/lib/sheets/settings";
import { readDriveTermsImageFile } from "@/lib/storage/drive-client";
import { sendLinePushMessage } from "./client";
import {
  LineDueTemplateError,
  renderLineDueMessageProfile,
  type ResolvedLineDueMessageProfiles,
  type ResolvedLineInstallmentReminderConfig,
} from "./message-profile";
import {
  buildLineMessageTestFixture,
  type LineMessageTestProfile,
  type LineMessageTestScenario,
} from "./message-test-profile";
import { resolveLineDueMessageValues } from "./message-values";
import { lineImageMessage, lineTermsImageUrl, selectLineTermsImage, type PaymentMessageImageDependencies } from "./payment-message-images";

type LinePushResult = { accepted: boolean; retryable: boolean; requestId: string; errorCode: string };
type LinePushRequest = Omit<Parameters<typeof sendLinePushMessage>[0], "fetchFn">;

export type LineMessageTestDeliveryDependencies = PaymentMessageImageDependencies & {
  getProfile: () => Promise<LineMessageTestProfile | null>;
  getDueProfiles: () => Promise<ResolvedLineDueMessageProfiles>;
  getReminderConfig: () => Promise<ResolvedLineInstallmentReminderConfig>;
  getLineChannelAccessToken: () => Promise<string>;
  sendPush: (input: LinePushRequest) => Promise<LinePushResult>;
  appendAudit: (record: PaymentAuditInput) => Promise<void>;
  createRetryKey: () => string;
  now: () => string;
};

export type LineMessageTestPreview = {
  text: string;
  messages: Array<{ type: "text"; text: string } | { type: "image"; originalContentUrl: string; previewImageUrl: string }>;
};

export type LineMessageTestSendResult = {
  outcome: "ACCEPTED" | "FAILED" | "REVIEW";
  requestCode: string;
  preview?: string;
};

async function runtimeDependencies(): Promise<LineMessageTestDeliveryDependencies> {
  return {
    getProfile: getLineMessageTestProfile,
    getDueProfiles: getLineDueMessageProfiles,
    getReminderConfig: getLineInstallmentReminderConfig,
    getLineTermsImageState,
    readDriveTermsImageFile,
    getLineChannelAccessToken,
    sendPush: (input) => sendLinePushMessage({ ...input, fetchFn: fetch }),
    appendAudit,
    createRetryKey: randomUUID,
    now: () => new Date().toISOString(),
  };
}

function safeTestQrUrl(baseUrl: string): string {
  const url = new URL("/api/line/message-test-qr", baseUrl);
  if (url.protocol !== "https:") throw new Error("HTTPS_BASE_URL_REQUIRED");
  return url.toString();
}

async function buildPreview(
  input: { profile: LineMessageTestProfile; scenario: LineMessageTestScenario; baseUrl: string; now: string },
  dependencies: LineMessageTestDeliveryDependencies,
): Promise<LineMessageTestPreview> {
  const fixture = buildLineMessageTestFixture({ ...input });
  const { paymentType, values } = resolveLineDueMessageValues({
    payment: fixture.payment,
    client: fixture.client,
    schedules: fixture.schedules,
  });
  let messageProfile;
  if (input.scenario.stage === "LATER") {
    const resolved = await dependencies.getReminderConfig();
    if (resolved.kind === "INVALID") throw new LineDueTemplateError("TEMPLATE_INVALID", "Stored LINE reminder profile is invalid");
    messageProfile = resolved.config.profiles[input.scenario.reminderSlot];
  } else {
    const resolved = await dependencies.getDueProfiles();
    const profile = resolved[paymentType];
    if (profile.kind === "INVALID") throw new LineDueTemplateError("TEMPLATE_INVALID", "Stored LINE profile is invalid");
    messageProfile = profile.profile;
  }
  const text = renderLineDueMessageProfile(messageProfile, paymentType, values);
  const qr = lineImageMessage(safeTestQrUrl(input.baseUrl));
  const terms = await selectLineTermsImage({ payment: fixture.payment, schedules: fixture.schedules }, dependencies);
  const termsMessage = terms.token === "NONE"
    ? []
    : [lineImageMessage(lineTermsImageUrl(input.baseUrl, terms.token))];
  return { text, messages: [{ type: "text", text }, qr, ...termsMessage] };
}

export async function previewLineMessageTest(
  input: { scenario: LineMessageTestScenario; baseUrl: string; profile?: LineMessageTestProfile },
  injectedDependencies?: LineMessageTestDeliveryDependencies,
): Promise<LineMessageTestPreview> {
  const dependencies = injectedDependencies ?? await runtimeDependencies();
  const profile = input.profile ?? await dependencies.getProfile();
  if (!profile) throw new Error("LINE_MESSAGE_TEST_PROFILE_MISSING");
  return buildPreview({ ...input, profile, now: dependencies.now() }, dependencies);
}

function auditMetadata(
  profile: LineMessageTestProfile,
  scenario: LineMessageTestScenario,
  outcome: LineMessageTestSendResult["outcome"],
  requestCode: string,
): string {
  return JSON.stringify({
    scenario: scenario.stage === "INITIAL" ? "INITIAL" : "REMINDER",
    paymentType: scenario.paymentType,
    stage: scenario.stage,
    ...(scenario.stage === "LATER" ? { installmentNumber: scenario.installmentNumber, reminderSlot: scenario.reminderSlot } : {}),
    lineUserSuffix: profile.lineUserId.slice(-4),
    requestCode,
    outcome,
  });
}

async function appendTestAudit(
  dependencies: LineMessageTestDeliveryDependencies,
  profile: LineMessageTestProfile,
  scenario: LineMessageTestScenario,
  result: LineMessageTestSendResult,
): Promise<boolean> {
  try {
    await dependencies.appendAudit({
      paymentId: "",
      clientId: "",
      action: "LINE_MESSAGE_TEST_SENT",
      previousStatus: "",
      newStatus: result.outcome,
      reason: "LINE message test delivery",
      source: "LINE_MESSAGE_TEST",
      metadata: auditMetadata(profile, scenario, result.outcome, result.requestCode),
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendLineMessageTest(
  input: { scenario: LineMessageTestScenario; baseUrl: string; profile?: LineMessageTestProfile },
  injectedDependencies?: LineMessageTestDeliveryDependencies,
): Promise<LineMessageTestSendResult> {
  const dependencies = injectedDependencies ?? await runtimeDependencies();
  const profile = input.profile ?? await dependencies.getProfile();
  if (!profile) return { outcome: "FAILED", requestCode: "PROFILE_MISSING" };

  let result: LineMessageTestSendResult;
  if (profile.lineLinkStatus !== "LINKED" || !profile.lineUserId) {
    result = { outcome: "FAILED", requestCode: "RECIPIENT_NOT_LINKED" };
  } else {
    try {
      const preview = await buildPreview({ ...input, profile, now: dependencies.now() }, dependencies);
      const channelAccessToken = await dependencies.getLineChannelAccessToken();
      const retryKey = dependencies.createRetryKey();
      let pushResult: LinePushResult = { accepted: false, retryable: true, requestId: "", errorCode: "NETWORK_ERROR" };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          pushResult = await dependencies.sendPush({ channelAccessToken, to: profile.lineUserId, retryKey, messages: preview.messages });
        } catch {
          pushResult = { accepted: false, retryable: true, requestId: "", errorCode: "NETWORK_ERROR" };
        }
        if (pushResult.accepted || !pushResult.retryable) break;
      }
      result = pushResult.accepted
        ? { outcome: "ACCEPTED", requestCode: pushResult.requestId || "ACCEPTED", preview: preview.text }
        : pushResult.errorCode === "NETWORK_ERROR"
          ? { outcome: "REVIEW", requestCode: "NETWORK_ERROR", preview: preview.text }
          : { outcome: "FAILED", requestCode: pushResult.errorCode || "LINE_REQUEST_FAILED", preview: preview.text };
    } catch (error) {
      result = {
        outcome: "FAILED",
        requestCode: error instanceof LineDueTemplateError ? error.code : "DELIVERY_ERROR",
      };
    }
  }

  if (!await appendTestAudit(dependencies, profile, input.scenario, result)) {
    return { outcome: "REVIEW", requestCode: "AUDIT_FAILED", preview: result.preview };
  }
  return result;
}
