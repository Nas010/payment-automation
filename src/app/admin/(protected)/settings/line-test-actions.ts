"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin-auth";
import { bangkokDateKey } from "@/lib/date";
import { buildLineConnectUrl, recoverLineConnectionToken } from "@/lib/line/connection-token";
import { createLineMessageTestConnectionService } from "@/lib/line/message-test-connection";
import { previewLineMessageTest, sendLineMessageTest } from "@/lib/line/message-test-delivery";
import {
  createDefaultLineMessageTestProfile,
  mergeLineMessageTestDetails,
  parseLineMessageTestDetails,
  parseLineMessageTestScenario,
  toLineMessageTestAdminView,
  type LineMessageTestAdminView,
  type LineMessageTestProfile,
} from "@/lib/line/message-test-profile";
import { runtimeConfig } from "@/lib/runtime-config";
import { listClients } from "@/lib/sheets/clients";
import {
  claimLineMessageTestConnection,
  disconnectLineMessageTestConnection,
  getLineMessageTestProfile,
  saveLineMessageTestProfile,
  updateLineMessageTestProfileIfUnchanged,
} from "@/lib/sheets/line-message-test-profile";
import { appendAudit } from "@/lib/sheets/payments";

export type LineMessageTestActionResult =
  | {
    ok: true;
    profile: LineMessageTestAdminView;
    preview?: string;
    outcome?: "ACCEPTED" | "FAILED" | "REVIEW";
    requestCode?: string;
    connectUrl?: string;
  }
  | { ok: false; message: string };

export type SavedLineMessageTestActionResult =
  | { ok: true; outcome: "ACCEPTED" | "FAILED" | "REVIEW"; requestCode?: string }
  | { ok: false; message: string };

function editableDetails(formData: FormData) {
  return parseLineMessageTestDetails({
    clientName: String(formData.get("client_name") ?? ""),
    packageName: String(formData.get("package_name") ?? ""),
    totalPriceThb: String(formData.get("total_price_thb") ?? ""),
    paymentType: String(formData.get("payment_type") ?? ""),
    installmentCount: String(formData.get("installment_count") ?? ""),
    intervalMonths: String(formData.get("interval_months") ?? ""),
    firstDueDate: String(formData.get("first_due_date") ?? ""),
  });
}

function submittedScenario(formData: FormData) {
  const paymentType = String(formData.get("scenario_payment_type") ?? "");
  const stage = String(formData.get("scenario_stage") ?? "");
  return parseLineMessageTestScenario(stage === "LATER"
    ? {
      paymentType,
      stage,
      installmentNumber: String(formData.get("installment_number") ?? ""),
      reminderSlot: String(formData.get("reminder_slot") ?? ""),
    }
    : { paymentType, stage });
}

async function currentProfile(): Promise<LineMessageTestProfile> {
  return await getLineMessageTestProfile() ?? createDefaultLineMessageTestProfile(bangkokDateKey());
}

async function submittedProfile(formData: FormData): Promise<LineMessageTestProfile> {
  const current = await currentProfile();
  return mergeLineMessageTestDetails(current, editableDetails(formData), new Date().toISOString());
}

function connectionService() {
  return createLineMessageTestConnectionService({
    getProfile: getLineMessageTestProfile,
    listClients,
    updateProfileIfUnchanged: updateLineMessageTestProfileIfUnchanged,
    claimConnection: claimLineMessageTestConnection,
    disconnectConnection: disconnectLineMessageTestConnection,
    appendAudit,
  });
}

function safeFailure(message: string): LineMessageTestActionResult {
  return { ok: false, message };
}

export async function saveLineMessageTestProfileAction(formData: FormData): Promise<LineMessageTestActionResult> {
  await requireAdmin();
  try {
    const profile = await submittedProfile(formData);
    await saveLineMessageTestProfile(profile);
    revalidatePath("/admin/settings");
    return { ok: true, profile: toLineMessageTestAdminView(profile) };
  } catch {
    return safeFailure("Could not save the LINE test client. Check the fields and try again.");
  }
}

export async function renewLineMessageTestConnectionAction(): Promise<LineMessageTestActionResult> {
  await requireAdmin();
  try {
    if (!await getLineMessageTestProfile()) {
      await saveLineMessageTestProfile(createDefaultLineMessageTestProfile(bangkokDateKey()));
    }
    const now = new Date();
    const issued = await connectionService().issue({ now });
    const { lineLiffId } = await runtimeConfig();
    const token = recoverLineConnectionToken({
      clientId: "line-message-test-profile",
      encryptedToken: issued.lineLinkTokenEncrypted,
    });
    const connectUrl = buildLineConnectUrl({ liffId: lineLiffId, token });
    revalidatePath("/admin/settings");
    return { ok: true, profile: toLineMessageTestAdminView(issued), connectUrl };
  } catch {
    return safeFailure("Could not create the LINE test connection. Check LINE settings and try again.");
  }
}

export async function disconnectLineMessageTestConnectionAction(): Promise<LineMessageTestActionResult> {
  await requireAdmin();
  try {
    const current = await currentProfile();
    if (!await connectionService().disconnect({ now: new Date() })) {
      return safeFailure("Could not disconnect the LINE test account. Try again.");
    }
    const cleared: LineMessageTestProfile = {
      ...current,
      lineUserId: "", lineDisplayName: "", linePictureUrl: "", lineLinkStatus: "", lineLinkedAt: "", lineLinkError: "",
      lineLinkTokenHash: "", lineLinkTokenEncrypted: "", lineLinkTokenExpiresAt: "", updatedAt: new Date().toISOString(),
    };
    revalidatePath("/admin/settings");
    return { ok: true, profile: toLineMessageTestAdminView(cleared) };
  } catch {
    return safeFailure("Could not disconnect the LINE test account. Try again.");
  }
}

export async function previewLineMessageTestAction(formData: FormData): Promise<LineMessageTestActionResult> {
  await requireAdmin();
  try {
    const [profile, scenario, config] = await Promise.all([
      submittedProfile(formData),
      Promise.resolve(submittedScenario(formData)),
      runtimeConfig(),
    ]);
    const preview = await previewLineMessageTest({ scenario, baseUrl: config.publicBaseUrl, profile });
    return { ok: true, profile: toLineMessageTestAdminView(profile), preview: preview.text };
  } catch {
    return safeFailure("Could not preview this LINE test. Check the scenario and templates.");
  }
}

export async function sendLineMessageTestAction(formData: FormData): Promise<LineMessageTestActionResult> {
  await requireAdmin();
  try {
    const [profile, scenario, config] = await Promise.all([
      submittedProfile(formData),
      Promise.resolve(submittedScenario(formData)),
      runtimeConfig(),
    ]);
    const result = await sendLineMessageTest({ scenario, baseUrl: config.publicBaseUrl, profile });
    revalidatePath("/admin/settings");
    return {
      ok: true,
      profile: toLineMessageTestAdminView(profile),
      outcome: result.outcome,
      requestCode: result.requestCode,
      preview: result.preview,
    };
  } catch {
    return safeFailure("Could not send this LINE test. Check the connection and try again.");
  }
}

export async function sendSavedLineMessageTestAction(formData: FormData): Promise<SavedLineMessageTestActionResult> {
  await requireAdmin();
  try {
    const paymentType = String(formData.get("payment_type") ?? "");
    const reminderSlot = String(formData.get("reminder_slot") ?? "");
    const scenario = reminderSlot
      ? parseLineMessageTestScenario({ paymentType: "INSTALLMENTS", stage: "LATER", installmentNumber: "2", reminderSlot })
      : parseLineMessageTestScenario({ paymentType, stage: "INITIAL" });
    const [profile, config] = await Promise.all([currentProfile(), runtimeConfig()]);
    const result = await sendLineMessageTest({ scenario, baseUrl: config.publicBaseUrl, profile });
    return { ok: true, outcome: result.outcome, requestCode: result.requestCode };
  } catch {
    return { ok: false, message: "Could not send this saved template to the LINE test client. Check the test connection and try again." };
  }
}
