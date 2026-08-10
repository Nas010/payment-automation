"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { getLineChannelAccessToken, setSecret } from "@/lib/secrets/service";
import { upsertOperationalSetting } from "@/lib/sheets/settings";
import type { LineCredentialActionResult } from "@/components/admin/line-integration-form";

const validationSettingKey = "line_access_token_validation";

function submittedValue(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function saveAndTestLineCredentialsAction(formData: FormData): Promise<LineCredentialActionResult> {
  await requireAdmin();
  const accessToken = submittedValue(formData, "channel_access_token");
  const channelSecret = submittedValue(formData, "channel_secret");
  const validatedAt = new Date().toISOString();
  let status: LineCredentialActionResult["status"] = "FAILED";

  try {
    if (accessToken) await setSecret({ keyName: "line_channel_access_token", plaintext: accessToken });
    if (channelSecret) await setSecret({ keyName: "line_channel_secret", plaintext: channelSecret });
    const resolvedAccessToken = await getLineChannelAccessToken();
    const response = await fetch("https://api.line.me/v2/bot/info", { headers: { Authorization: `Bearer ${resolvedAccessToken}` } });
    status = response.ok ? "VALID" : "FAILED";
  } catch {
    status = "FAILED";
  }

  await upsertOperationalSetting(validationSettingKey, JSON.stringify({ status, validatedAt }));
  revalidatePath("/admin/settings");
  return { ok: status === "VALID", status, validatedAt };
}
