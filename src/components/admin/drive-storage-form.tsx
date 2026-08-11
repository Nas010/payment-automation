"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type DriveStorageActionResult = { ok: boolean; status: "VALID" | "FAILED"; message: string; folderName?: string; validatedAt: string };

export function DriveStorageForm({
  serviceAccountEmail,
  source,
  folderName,
  validatedAt,
  action,
}: {
  serviceAccountEmail: string;
  source: "oauth" | "workbook" | "environment" | "unconfigured";
  folderName?: string;
  validatedAt?: string;
  action: (formData: FormData) => Promise<DriveStorageActionResult>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [outcome, setOutcome] = useState<DriveStorageActionResult | null>(null);

  const submit = () => {
    const formData = new FormData(formRef.current!);
    startTransition(async () => {
      try {
        const result = await action(formData);
        setOutcome(result);
        if (result.ok) formRef.current?.reset();
      } catch {
        setOutcome({ ok: false, status: "FAILED", message: "Could not connect Google Drive. Try again.", validatedAt: new Date().toISOString() });
      }
    });
  };

  const copyEmail = async () => {
    await navigator.clipboard.writeText(serviceAccountEmail);
    setCopied(true);
  };

  const sourceLabel = source === "oauth" ? "Google account" : source === "workbook" ? "Workbook" : source === "environment" ? "Environment fallback" : "Not configured";
  const activeDescription = [sourceLabel, folderName, validatedAt].filter(Boolean).join(" · ");

  return <Card>
    <CardHeader><CardTitle>Google Drive slip storage</CardTitle><CardDescription>Share a private folder with this service account as Editor, then paste its folder URL or ID.</CardDescription></CardHeader>
    <CardContent>
      <div className="mb-5 flex flex-wrap items-center gap-3 text-sm"><span className="font-medium">{serviceAccountEmail || "Service-account email unavailable"}</span><Button type="button" variant="outline" size="sm" disabled={!serviceAccountEmail} onClick={copyEmail}>{copied ? "Copied" : "Copy email"}</Button></div>
      <p className="mb-5 text-sm text-muted-foreground">{activeDescription}</p>
      <form ref={formRef} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <FieldGroup><Field><FieldLabel htmlFor="drive_folder">Drive folder URL or ID</FieldLabel><Input id="drive_folder" name="folder" required /><FieldDescription>A failed test keeps the current folder active.</FieldDescription></Field></FieldGroup>
        <div className="mt-5 flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending}>{pending ? "Testing…" : "Save & Test"}</Button>{outcome ? <p className={outcome.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{outcome.message}</p> : null}</div>
      </form>
    </CardContent>
  </Card>;
}
