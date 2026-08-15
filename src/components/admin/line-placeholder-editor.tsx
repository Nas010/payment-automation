"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export type PlaceholderOption = { name: string; label: string };

type Props = {
  id: string;
  label: string;
  value: string;
  placeholders: PlaceholderOption[];
  onChange: (value: string) => void;
  rows?: number;
  disabled?: boolean;
};

export function LinePlaceholderEditor({ id, label, value, placeholders, onChange, rows = 4, disabled = false }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const insert = (name: string) => {
    const textarea = ref.current;
    if (!textarea) return;
    const token = `{{${name}}}`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
    requestAnimationFrame(() => {
      const caret = start + token.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  };

  return <Field aria-label={`${label} editor`}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <div className="flex flex-wrap gap-2">
      {placeholders.map((item) => <Button key={item.name} type="button" size="sm" variant="outline" aria-label={`Insert {{${item.name}}}`} disabled={disabled} onClick={() => insert(item.name)}>{item.label}</Button>)}
    </div>
    <Textarea ref={ref} id={id} value={value} onChange={(event) => onChange(event.target.value)} rows={rows} disabled={disabled} />
  </Field>;
}
