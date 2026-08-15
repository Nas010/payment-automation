"use client";

import { LineMessageTemplateForm, type LineTemplateActionResult } from "@/components/admin/line-message-template-form";

type Props = {
  template: string;
  previewAction: (formData: FormData) => Promise<LineTemplateActionResult>;
  saveAction: (formData: FormData) => Promise<LineTemplateActionResult>;
  resetAction: () => Promise<LineTemplateActionResult>;
};

export function LineWelcomeTemplateForm({ template, previewAction, saveAction, resetAction }: Props) {
  return <LineMessageTemplateForm
    template={template}
    title="LINE welcome message"
    description="This global message is rendered on demand for each unlinked client. Use supported placeholders: client_name, business_name, and line_connect_url."
    label="Welcome message template"
    fieldDescription="Required: line_connect_url. Message limit: 5,000 characters after substitution."
    errorMessage="Could not update LINE welcome template."
    previewAction={previewAction}
    saveAction={saveAction}
    resetAction={resetAction}
  />;
}
