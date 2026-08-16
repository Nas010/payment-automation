import { LineDueTemplateForm } from "@/components/admin/line-due-template-form";
import { LineInstallmentReminderForm } from "@/components/admin/line-installment-reminder-form";
import { LineWelcomeTemplateForm } from "@/components/admin/line-welcome-template-form";
import { LineAutomaticReplyForm } from "@/components/admin/line-automatic-reply-form";
import { MessagesSettingsWorkspace } from "@/components/admin/messages-settings-workspace";
import { DEFAULT_LINE_WELCOME_TEMPLATE } from "@/lib/line/message-template";
import { resolveLineAutomaticReplyConfig } from "@/lib/line/reply-config";
import { listOperationalSettings, resolveLineDueMessageProfiles, resolveLineInstallmentReminderConfig } from "@/lib/sheets/settings";
import { previewLineDueMessageProfileAction, previewLineInstallmentReminderAction, previewLineWelcomeTemplateAction, resetLineAutomaticReplyConfigAction, resetLineDueMessageProfileAction, resetLineInstallmentReminderConfigAction, resetLineWelcomeTemplateAction, saveLineAutomaticReplyConfigAction, saveLineDueMessageProfileAction, saveLineInstallmentReminderConfigAction, saveLineWelcomeTemplateAction } from "../line-actions";
import { sendSavedLineMessageTestAction } from "../line-test-actions";

export default async function MessagesSettingsPage() {
  const settings = await listOperationalSettings();
  const dueProfiles = resolveLineDueMessageProfiles(settings);
  const reminderConfig = resolveLineInstallmentReminderConfig(settings);
  const automaticReplies = resolveLineAutomaticReplyConfig(settings);
  const welcomeTemplate = settings.find((item) => item.key === "line_welcome_message_template")?.value || DEFAULT_LINE_WELCOME_TEMPLATE;

  return <MessagesSettingsWorkspace
    welcome={<LineWelcomeTemplateForm template={welcomeTemplate} previewAction={previewLineWelcomeTemplateAction} saveAction={saveLineWelcomeTemplateAction} resetAction={resetLineWelcomeTemplateAction} />}
    automaticReplies={<LineAutomaticReplyForm resolved={automaticReplies} saveAction={saveLineAutomaticReplyConfigAction} resetAction={resetLineAutomaticReplyConfigAction} />}
    paymentMessages={<LineDueTemplateForm profiles={dueProfiles} previewAction={previewLineDueMessageProfileAction} saveAction={saveLineDueMessageProfileAction} resetAction={resetLineDueMessageProfileAction} sendTestAction={sendSavedLineMessageTestAction} />}
    reminders={<LineInstallmentReminderForm resolved={reminderConfig} previewAction={previewLineInstallmentReminderAction} saveAction={saveLineInstallmentReminderConfigAction} resetAction={resetLineInstallmentReminderConfigAction} />}
  />;
}
