"use client";

import React, { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export type LineTemplateActionResult = { ok: true; preview: string; template?: string };

type Props = {
  template: string;
  title: string;
  description: string;
  label: string;
  fieldDescription: string;
  status?: React.ReactNode;
  errorMessage: string;
  previewAction: (formData: FormData) => Promise<LineTemplateActionResult>;
  saveAction: (formData: FormData) => Promise<LineTemplateActionResult>;
  resetAction: () => Promise<LineTemplateActionResult>;
};

export function LineMessageTemplateForm({ template, title, description, label, fieldDescription, status, errorMessage, previewAction, saveAction, resetAction }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(template);
  const [preview, setPreview] = useState("");
  const [outcome, setOutcome] = useState("");
  const [pending, startTransition] = useTransition();

  const runTemplateAction = (action: (formData: FormData) => Promise<LineTemplateActionResult>, success: string) => {
    const formData = new FormData(formRef.current!);
    setOutcome("");
    startTransition(async () => {
      try {
        const result = await action(formData);
        setPreview(result.preview);
        if (result.template !== undefined) setValue(result.template);
        setOutcome(success);
      } catch (error) {
        setOutcome(error instanceof Error ? error.message : errorMessage);
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
        setOutcome(error instanceof Error ? error.message : errorMessage);
      }
    });
  };

  return <Card>
    <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
    <CardContent>
      {status}
      <form ref={formRef} onSubmit={(event) => { event.preventDefault(); runTemplateAction(saveAction, "Template saved."); }}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${label.toLowerCase().replaceAll(" ", "_")}_template`}>{label}</FieldLabel>
            <Textarea id={`${label.toLowerCase().replaceAll(" ", "_")}_template`} name="template" value={value} onChange={(event) => setValue(event.target.value)} rows={10} required />
            <FieldDescription>{fieldDescription}</FieldDescription>
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
