import { LineDueTemplateForm } from "@/components/admin/line-due-template-form";
import { LineInstallmentReminderForm } from "@/components/admin/line-installment-reminder-form";
import { LineWelcomeTemplateForm } from "@/components/admin/line-welcome-template-form";
import { LineAutomaticReplyForm } from "@/components/admin/line-automatic-reply-form";
import { DEFAULT_LINE_WELCOME_TEMPLATE } from "@/lib/line/message-template";
import { resolveLineAutomaticReplyConfig } from "@/lib/line/reply-config";
import { runtimeConfig } from "@/lib/runtime-config";
import { listOperationalSettings, resolveLineDueMessageProfiles, resolveLineInstallmentReminderConfig } from "@/lib/sheets/settings";
import { previewLineDueMessageProfileAction, previewLineInstallmentReminderAction, previewLineWelcomeTemplateAction, resetLineAutomaticReplyConfigAction, resetLineDueMessageProfileAction, resetLineInstallmentReminderConfigAction, resetLineWelcomeTemplateAction, saveLineAutomaticReplyConfigAction, saveLineDueMessageProfileAction, saveLineInstallmentReminderConfigAction, saveLineWelcomeTemplateAction } from "../line-actions";

export default async function MessagesSettingsPage() {
  const [settings, config] = await Promise.all([listOperationalSettings(), runtimeConfig()]);
  const dueProfiles = resolveLineDueMessageProfiles(settings);
  const reminderConfig = resolveLineInstallmentReminderConfig(settings);
  const automaticReplies = resolveLineAutomaticReplyConfig(settings);
  const welcomeTemplate = settings.find((item) => item.key === "line_welcome_message_template")?.value || DEFAULT_LINE_WELCOME_TEMPLATE;

  return <div className="flex flex-col gap-6">
    <LineWelcomeTemplateForm template={welcomeTemplate} previewAction={previewLineWelcomeTemplateAction} saveAction={saveLineWelcomeTemplateAction} resetAction={resetLineWelcomeTemplateAction} />
    <LineAutomaticReplyForm resolved={automaticReplies} saveAction={saveLineAutomaticReplyConfigAction} resetAction={resetLineAutomaticReplyConfigAction} />
    <LineDueTemplateForm profiles={dueProfiles} messagingEnabled={config.lineMessagingEnabled} chatPaymentsEnabled={config.lineChatPaymentsEnabled} previewAction={previewLineDueMessageProfileAction} saveAction={saveLineDueMessageProfileAction} resetAction={resetLineDueMessageProfileAction} />
    <LineInstallmentReminderForm resolved={reminderConfig} previewAction={previewLineInstallmentReminderAction} saveAction={saveLineInstallmentReminderConfigAction} resetAction={resetLineInstallmentReminderConfigAction} />
  </div>;
}
