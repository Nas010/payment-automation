"use client";

import React, { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export type LineDueTemplateActionResult = { ok: true; preview: string; template?: string };

type Props = {
  template: string;
  messagingEnabled: boolean;
  chatPaymentsEnabled: boolean;
  previewAction: (formData: FormData) => Promise<LineDueTemplateActionResult>;
  saveAction: (formData: FormData) => Promise<LineDueTemplateActionResult>;
  resetAction: () => Promise<LineDueTemplateActionResult>;
};

export function LineDueTemplateForm({ template, messagingEnabled, chatPaymentsEnabled, previewAction, saveAction, resetAction }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(template);
  const [preview, setPreview] = useState("");
  const [outcome, setOutcome] = useState("");
  const [pending, startTransition] = useTransition();

  const runTemplateAction = (action: (formData: FormData) => Promise<LineDueTemplateActionResult>, success: string) => {
    const formData = new FormData(formRef.current!);
    setOutcome("");
    startTransition(async () => {
      try {
        const result = await action(formData);
        setPreview(result.preview);
        if (result.template !== undefined) setValue(result.template);
        setOutcome(success);
      } catch (error) {
        setOutcome(error instanceof Error ? error.message : "Could not update LINE due-payment template.");
      }
    });
  };

  const restoreDefault = () => {
    setOutcome("");
    startTransition(async () => {
      try {
        const result = await resetAction();
        setValue(result.template ?? value);
        setPreview(result.preview);
        setOutcome("Documented default restored.");
      } catch (error) {
        setOutcome(error instanceof Error ? error.message : "Could not restore LINE due-payment template.");
      }
    });
  };

  return <Card>
    <CardHeader>
      <CardTitle>LINE due-payment message</CardTitle>
      <CardDescription>Use supported placeholders: client_name, payment_label, amount, due_date, and payment_url. Preview is rendered by the protected server action.</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="mb-4 flex flex-wrap gap-2 text-sm text-muted-foreground">
        <span>{messagingEnabled ? "LINE messaging enabled" : "LINE messaging disabled"}</span>
        <span>{chatPaymentsEnabled ? "LINE chat payments enabled" : "LINE chat payments disabled"}</span>
      </div>
      <form ref={formRef} onSubmit={(event) => { event.preventDefault(); runTemplateAction(saveAction, "Template saved."); }}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="line_due_template">Due-payment message template</FieldLabel>
            <Textarea id="line_due_template" name="template" value={value} onChange={(event) => setValue(event.target.value)} rows={10} required />
            <FieldDescription>Required: amount, due_date, payment_url. Message limit: 5,000 characters after substitution.</FieldDescription>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => runTemplateAction(previewAction, "")}>Preview message</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save template"}</Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={restoreDefault}>Restore default</Button>
          </div>
        </FieldGroup>
      </form>
      {preview ? <pre className="mt-4 whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{preview}</pre> : null}
      {outcome ? <p className="mt-3 text-sm" aria-live="polite">{outcome}</p> : null}
    </CardContent>
  </Card>;
}
