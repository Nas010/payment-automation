"use client";

import React, { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type LineCredentialMetadata = {
  keyName: "line_channel_access_token" | "line_channel_secret";
  configured: boolean;
  source: "encrypted" | "environment" | "unconfigured";
  lastFour?: string;
  updatedAt?: string;
};

export type LineCredentialActionResult = { ok: boolean; status: "VALID" | "FAILED"; validatedAt: string };

export function LineIntegrationForm({ credentials, action, validation }: { credentials: LineCredentialMetadata[]; action: (formData: FormData) => Promise<LineCredentialActionResult>; validation?: { status: "VALID" | "FAILED"; validatedAt: string } }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState(validation);
  const [error, setError] = useState("");
  const access = credentials.find((item) => item.keyName === "line_channel_access_token");
  const secret = credentials.find((item) => item.keyName === "line_channel_secret");
  const submit = () => {
    const formData = new FormData(formRef.current!);
    setError("");
    startTransition(async () => {
      try {
        const result = await action(formData);
        setOutcome({ status: result.status, validatedAt: result.validatedAt });
      } catch {
        setError("Could not save LINE credentials. Try again.");
      } finally {
        formRef.current?.reset();
      }
    });
  };

  return <Card><CardHeader><CardTitle>LINE integration</CardTitle><CardDescription>Credentials are encrypted server-side. Leave a field blank to keep its current value.</CardDescription></CardHeader><CardContent><form ref={formRef} onSubmit={(event) => { event.preventDefault(); submit(); }}><FieldGroup className="grid gap-4 sm:grid-cols-2"><CredentialField label="Channel access token" name="channel_access_token" metadata={access} /><CredentialField label="Channel secret" name="channel_secret" metadata={secret} /></FieldGroup><div className="mt-5 flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save & Test"}</Button>{outcome ? <p className={outcome.status === "VALID" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{outcome.status === "VALID" ? "LINE connection validated." : "LINE validation failed. Check credentials and try again."} <span className="text-muted-foreground">{outcome.validatedAt}</span></p> : null}{error ? <p className="text-sm text-destructive">{error}</p> : null}</div></form></CardContent></Card>;
}

function CredentialField({ label, name, metadata }: { label: string; name: "channel_access_token" | "channel_secret"; metadata?: LineCredentialMetadata }) {
  return <Field><FieldLabel htmlFor={name}>{label}</FieldLabel><Input id={name} name={name} type="password" autoComplete="new-password" defaultValue="" /><FieldDescription>{credentialDescription(metadata)}</FieldDescription></Field>;
}

function credentialDescription(metadata?: LineCredentialMetadata): string {
  if (!metadata || !metadata.configured) return "Not configured";
  if (metadata.source === "environment") return "Configured via environment";
  return `Configured ••••${metadata.lastFour || ""}${metadata.updatedAt ? ` · Updated ${metadata.updatedAt}` : ""}`;
}
