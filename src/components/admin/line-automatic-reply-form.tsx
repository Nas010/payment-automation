"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { LineAutomaticReplyConfig, ResolvedLineAutomaticReplyConfig } from "@/lib/line/reply-config";

type ActionResult = { ok: true; config: LineAutomaticReplyConfig };

type Props = {
  resolved: ResolvedLineAutomaticReplyConfig;
  saveAction: (formData: FormData) => Promise<ActionResult>;
  resetAction: () => Promise<ActionResult>;
};

function ReplyField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Textarea id={id} value={value} rows={4} maxLength={5000} required onChange={(event) => onChange(event.target.value)} />
  </Field>;
}

export function LineAutomaticReplyForm({ resolved, saveAction, resetAction }: Props) {
  const [draft, setDraft] = useState(resolved.config);
  const [outcome, setOutcome] = useState("");
  const [pending, startTransition] = useTransition();

  const updateSlip = (value: string) => setDraft((current) => ({ ...current, slip: { received: value } }));

  const save = () => {
    const formData = new FormData();
    formData.set("config", JSON.stringify(draft));
    setOutcome("");
    startTransition(async () => {
      try {
        const result = await saveAction(formData);
        setDraft(result.config);
        setOutcome("Automatic replies saved.");
      } catch (error) {
        setOutcome(error instanceof Error && error.message ? error.message : "Could not save automatic replies.");
      }
    });
  };

  const restoreDefaults = () => {
    setOutcome("");
    startTransition(async () => {
      try {
        const result = await resetAction();
        setDraft(result.config);
        setOutcome("Documented defaults restored.");
      } catch (error) {
        setOutcome(error instanceof Error && error.message ? error.message : "Could not restore automatic replies.");
      }
    });
  };

  return <section className="flex flex-col gap-4">
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold">Automatic replies</h2>
      <p className="text-sm text-muted-foreground">Message LINE sends after a payment slip is received.</p>
    </div>
    {resolved.kind === "INVALID" ? <p className="text-sm text-destructive">Saved automatic replies are invalid. Defaults are active until you save or restore them.</p> : null}
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <Card>
        <CardHeader>
          <CardTitle>Payment slip received</CardTitle>
          <CardDescription>This single message is sent after every payment-slip submission.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <ReplyField id="line-slip-received" label="Payment slip received message" value={draft.slip.received} onChange={updateSlip} />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save automatic replies"}</Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={restoreDefaults}>Restore defaults</Button>
        </CardFooter>
      </Card>
    </form>
    {outcome ? <p className="text-sm" aria-live="polite">{outcome}</p> : null}
  </section>;
}
