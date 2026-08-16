"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { LineAutomaticReplyConfig, ResolvedLineAutomaticReplyConfig } from "@/lib/line/reply-config";

type ActionResult = { ok: true; config: LineAutomaticReplyConfig };

type Props = {
  resolved: ResolvedLineAutomaticReplyConfig;
  saveAction: (formData: FormData) => Promise<ActionResult>;
  resetAction: () => Promise<ActionResult>;
};

type SlipField = keyof LineAutomaticReplyConfig["slip"];
type ConnectionField = keyof LineAutomaticReplyConfig["connection"];

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

  const updateSlip = (field: SlipField, value: string) => setDraft((current) => ({ ...current, slip: { ...current.slip, [field]: value } }));
  const updateConnection = (field: ConnectionField, value: string) => setDraft((current) => ({ ...current, connection: { ...current.connection, [field]: value } }));

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
      <p className="text-sm text-muted-foreground">Messages LINE sends after payment-slip processing or account connection.</p>
    </div>
    {resolved.kind === "INVALID" ? <p className="text-sm text-destructive">Saved automatic replies are invalid. Defaults are active until you save or restore them.</p> : null}
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <Card>
        <CardHeader>
          <CardTitle>Reply templates</CardTitle>
          <CardDescription>Choose the event group to edit. Changes are saved together.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="payment-slips">
            <TabsList>
              <TabsTrigger value="payment-slips">Payment slip replies</TabsTrigger>
              <TabsTrigger value="connections">LINE connection replies</TabsTrigger>
            </TabsList>
            <TabsContent value="payment-slips" className="mt-4">
              <FieldGroup>
                <ReplyField id="line-slip-auto-recorded" label="Payment recorded automatically" value={draft.slip.autoRecorded} onChange={(value) => updateSlip("autoRecorded", value)} />
                <ReplyField id="line-slip-review" label="Payment needs review" value={draft.slip.review} onChange={(value) => updateSlip("review", value)} />
                <ReplyField id="line-slip-flagged" label="Payment flagged" value={draft.slip.flagged} onChange={(value) => updateSlip("flagged", value)} />
              </FieldGroup>
            </TabsContent>
            <TabsContent value="connections" className="mt-4">
              <FieldGroup>
                <ReplyField id="line-connection-linked" label="Connected successfully" value={draft.connection.linked} onChange={(value) => updateConnection("linked", value)} />
                <ReplyField id="line-connection-already-linked" label="Already connected" value={draft.connection.alreadyLinked} onChange={(value) => updateConnection("alreadyLinked", value)} />
                <ReplyField id="line-connection-invalid" label="Invalid, expired, or inactive" value={draft.connection.invalidOrExpired} onChange={(value) => updateConnection("invalidOrExpired", value)} />
                <ReplyField id="line-connection-conflict" label="Connection conflict" value={draft.connection.conflict} onChange={(value) => updateConnection("conflict", value)} />
              </FieldGroup>
            </TabsContent>
          </Tabs>
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
