import { LineIntegrationForm } from "@/components/admin/line-integration-form";
import { LineMessageTestForm } from "@/components/admin/line-message-test-form";
import { bangkokDateKey } from "@/lib/date";
import { buildLineConnectUrl, recoverLineConnectionToken } from "@/lib/line/connection-token";
import { createDefaultLineMessageTestProfile, LINE_MESSAGE_TEST_SUBJECT_ID, toLineMessageTestAdminView } from "@/lib/line/message-test-profile";
import { runtimeConfig } from "@/lib/runtime-config";
import { getSecretMetadata } from "@/lib/secrets/service";
import { listOperationalSettings, resolveLineMessageTestProfile } from "@/lib/sheets/settings";
import { saveAndTestLineCredentialsAction } from "../line-actions";
import {
  disconnectLineMessageTestConnectionAction,
  previewLineMessageTestAction,
  renewLineMessageTestConnectionAction,
  saveLineMessageTestProfileAction,
  sendLineMessageTestAction,
} from "../line-test-actions";
import { lineCredentialMetadata, validationMetadata } from "../line-settings";

export default async function LineSettingsPage() {
  const [settings, secretMetadata, config] = await Promise.all([listOperationalSettings(), getSecretMetadata(), runtimeConfig()]);
  const validation = validationMetadata(settings.find((item) => item.key === "line_access_token_validation")?.value);
  const fallback = createDefaultLineMessageTestProfile(bangkokDateKey());
  const resolvedTestProfile = resolveLineMessageTestProfile(settings, fallback);
  const testProfile = resolvedTestProfile.kind === "VALID" ? resolvedTestProfile.profile : fallback;
  let testConnectUrl = "";
  if (testProfile.lineLinkStatus === "LINK_ACTIVE" && testProfile.lineLinkTokenEncrypted && config.lineLiffId) {
    try {
      testConnectUrl = buildLineConnectUrl({
        liffId: config.lineLiffId,
        token: recoverLineConnectionToken({ clientId: LINE_MESSAGE_TEST_SUBJECT_ID, encryptedToken: testProfile.lineLinkTokenEncrypted }),
      });
    } catch {}
  }

  return <div className="space-y-6">
    <LineIntegrationForm credentials={lineCredentialMetadata(secretMetadata)} validation={validation} action={saveAndTestLineCredentialsAction} />
    <LineMessageTestForm
      initialProfile={toLineMessageTestAdminView(testProfile)}
      initialConnectUrl={testConnectUrl}
      linkingEnabled={config.lineLinkingEnabled}
      messagingEnabled={config.lineMessagingEnabled}
      saveAction={saveLineMessageTestProfileAction}
      renewAction={renewLineMessageTestConnectionAction}
      disconnectAction={disconnectLineMessageTestConnectionAction}
      previewAction={previewLineMessageTestAction}
      sendAction={sendLineMessageTestAction}
    />
  </div>;
}
