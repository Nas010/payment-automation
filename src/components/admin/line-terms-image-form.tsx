"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type LineTermsImageAction = (formData: FormData) => Promise<{ ok: boolean; status: "SAVED" | "FAILED"; message: string }>;

export function LineTermsImageForm({
  image,
  driveConnected,
  error = "",
  action,
}: {
  image: { previewUrl: string; uploadedAt: string } | null;
  driveConnected: boolean;
  error?: string;
  action: LineTermsImageAction;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const submitLabel = image ? "Replace T&S image" : "Upload T&S image";

  function submit(formData: FormData): void {
    setOutcome("");
    startTransition(() => {
      void action(formData).then((result) => {
        setOutcome(result.message);
        if (result.ok && fileInputRef.current) {
          fileInputRef.current.value = "";
          setSelectedFile(null);
        }
      }).catch(() => setOutcome("Could not save T&S image. Try again."));
    });
  }

  return <Card>
    <CardHeader>
      <CardTitle>LINE terms and conditions image</CardTitle>
      <CardDescription>Sent with every new plan’s first payment, including extensions. Image is stored in same connected Google Drive folder.</CardDescription>
    </CardHeader>
    <CardContent>
      {error ? <p className="mb-4 text-sm text-destructive" role="alert">{error}</p> : null}
      {image ? <div className="mb-4 space-y-2">
        <Image src={image.previewUrl} alt="Current terms and conditions" width={720} height={960} unoptimized className="max-h-80 w-auto rounded-md border object-contain" />
        <FieldDescription>Current image uploaded {new Date(image.uploadedAt).toLocaleString()}.</FieldDescription>
      </div> : null}
      <form ref={formRef} onSubmit={(event) => {
        event.preventDefault();
        if (!formRef.current || !driveConnected || pending) return;
        const formData = new FormData(formRef.current);
        if (selectedFile) formData.set("terms_image", selectedFile);
        submit(formData);
      }}>
        <Field>
          <FieldLabel htmlFor="terms_image">T&S image</FieldLabel>
          <Input ref={fileInputRef} id="terms_image" name="terms_image" type="file" accept="image/png,image/jpeg" disabled={!driveConnected || pending} onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
          <FieldDescription>JPEG or PNG, up to 1 MiB. Replacements keep older images available for existing payment retries.</FieldDescription>
        </Field>
        {!driveConnected ? <FieldDescription className="mt-3">Connect Google Drive above before uploading.</FieldDescription> : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!driveConnected || pending}>{submitLabel}</Button>
          {outcome ? <p className="text-sm" aria-live="polite">{outcome}</p> : null}
        </div>
      </form>
    </CardContent>
  </Card>;
}
