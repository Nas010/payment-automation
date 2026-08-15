import { LineDueTemplateForm } from "@/components/admin/line-due-template-form";
import { LineWelcomeTemplateForm } from "@/components/admin/line-welcome-template-form";
import { DEFAULT_LINE_WELCOME_TEMPLATE } from "@/lib/line/message-template";
import { runtimeConfig } from "@/lib/runtime-config";
import { listOperationalSettings, resolveLineDueMessageProfiles } from "@/lib/sheets/settings";
import { previewLineDueMessageProfileAction, previewLineWelcomeTemplateAction, resetLineDueMessageProfileAction, resetLineWelcomeTemplateAction, saveLineDueMessageProfileAction, saveLineWelcomeTemplateAction } from "../line-actions";

export default async function MessagesSettingsPage() {
  const [settings, config] = await Promise.all([listOperationalSettings(), runtimeConfig()]);
  const dueProfiles = resolveLineDueMessageProfiles(settings);
  const welcomeTemplate = settings.find((item) => item.key === "line_welcome_message_template")?.value || DEFAULT_LINE_WELCOME_TEMPLATE;

  return <div className="flex flex-col gap-6">
    <LineWelcomeTemplateForm template={welcomeTemplate} previewAction={previewLineWelcomeTemplateAction} saveAction={saveLineWelcomeTemplateAction} resetAction={resetLineWelcomeTemplateAction} />
    <LineDueTemplateForm profiles={dueProfiles} messagingEnabled={config.lineMessagingEnabled} chatPaymentsEnabled={config.lineChatPaymentsEnabled} previewAction={previewLineDueMessageProfileAction} saveAction={saveLineDueMessageProfileAction} resetAction={resetLineDueMessageProfileAction} />
  </div>;
}
