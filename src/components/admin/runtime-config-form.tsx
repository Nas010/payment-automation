"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { InfoIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildPromptPayPayload, type PromptPayType } from "@/lib/promptpay/generate";
import type { RuntimeConfig } from "@/lib/runtime-config";

function normalizeAliases(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function RecipientAliasesField({ initialAliases = [] }: { initialAliases?: readonly string[] }) {
  const [aliases, setAliases] = useState(() => normalizeAliases(initialAliases));
  const [draft, setDraft] = useState("");

  function addAliases(values: readonly string[]) {
    const next = normalizeAliases(values);
    if (next.length === 0) return;
    setAliases((current) => [...current, ...next.filter((alias) => !current.includes(alias))]);
  }

  function commitDraft() {
    addAliases(draft.split(","));
    setDraft("");
  }

  return <Field>
    <FieldLabel htmlFor="recipient_aliases">Recipient aliases</FieldLabel>
    <input type="hidden" name="recipient_aliases" value={aliases.join(", ")} />
    <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      {aliases.map((alias) => <span key={alias} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium">
        {alias}
        <button type="button" aria-label={`Remove ${alias}`} onClick={() => setAliases((current) => current.filter((value) => value !== alias))} className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <XIcon className="size-3" />
        </button>
      </span>)}
      <Input id="recipient_aliases" value={draft} onChange={(event) => {
        const parts = event.target.value.split(",");
        if (parts.length > 1) addAliases(parts.slice(0, -1));
        setDraft(parts.at(-1) ?? "");
      }} onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitDraft();
        }
        if (event.key === "Backspace" && !draft) setAliases((current) => current.slice(0, -1));
      }} onBlur={commitDraft} placeholder="Type an alias, then press Enter" className="h-7 min-w-36 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0" />
    </div>
  </Field>;
}

function FieldHelp({ label, children }: { label: string; children: React.ReactNode }) {
  return <Tooltip>
    <TooltipTrigger render={<button type="button" aria-label={label} className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><InfoIcon className="size-3.5" /></button>} />
    <TooltipContent>{children}</TooltipContent>
  </Tooltip>;
}

export function RuntimeConfigForm({ action, defaultBaseUrl, initial, allowLineFeatures = false, submitLabel = "Run checks and finish setup" }: { action: (formData: FormData) => Promise<void>; defaultBaseUrl: string; initial?: RuntimeConfig; allowLineFeatures?: boolean; submitLabel?: string }) {
  const [identifier, setIdentifier] = useState(initial?.promptPayIdentifier ?? "");
  const [type, setType] = useState<PromptPayType>(initial?.promptPayType ?? "phone");
  const [qrPreview, setQrPreview] = useState("");
  const [qrError, setQrError] = useState("");

  useEffect(() => {
    if (!identifier) {
      setQrPreview("");
      setQrError("");
      return;
    }
    try {
      const payload = buildPromptPayPayload(identifier, type, 100);
      void QRCode.toDataURL(payload, { width: 192, margin: 1 }).then((url) => {
        setQrPreview(url);
        setQrError("");
      });
    } catch (error) {
      setQrPreview("");
      setQrError(error instanceof Error ? error.message : "PromptPay identifier is invalid.");
    }
  }, [identifier, type]);

  return <form action={action} className="space-y-6">
    <FieldGroup className="grid gap-4 md:grid-cols-2">
      <Field><FieldLabel htmlFor="business_display_name">Business display name</FieldLabel><Input id="business_display_name" name="business_display_name" required defaultValue={initial?.businessDisplayName ?? "Coaching Payments"} /></Field>
      <Field><FieldLabel htmlFor="recipient_name_en">Recipient name (English)</FieldLabel><Input id="recipient_name_en" name="recipient_name_en" required defaultValue={initial?.recipientNameEn} /></Field>
      <Field><FieldLabel htmlFor="recipient_name_th">Recipient name (Thai)</FieldLabel><Input id="recipient_name_th" name="recipient_name_th" defaultValue={initial?.recipientNameTh} /></Field>
      <RecipientAliasesField initialAliases={initial?.recipientAliases} />
      <Field><FieldLabel htmlFor="promptpay_type">PromptPay type</FieldLabel><select id="promptpay_type" name="promptpay_type" value={type} onChange={(event) => setType(event.target.value as PromptPayType)} className="h-9 rounded-lg border bg-background px-3 text-sm"><option value="phone">Phone</option><option value="national_id">National ID</option><option value="ewallet">E-wallet</option></select></Field>
      <Field><FieldLabel htmlFor="promptpay_identifier">PromptPay identifier</FieldLabel><Input id="promptpay_identifier" name="promptpay_identifier" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} />{qrError ? <FieldDescription>{qrError}</FieldDescription> : null}</Field>
      <Field><FieldLabel htmlFor="public_base_url">Public base URL</FieldLabel><Input id="public_base_url" name="public_base_url" type="url" required defaultValue={initial?.publicBaseUrl ?? defaultBaseUrl} /></Field>
      <Field><FieldLabel htmlFor="slip_retention_days">Slip retention (days)</FieldLabel><Input id="slip_retention_days" name="slip_retention_days" type="number" min="0" max="365" required defaultValue={initial?.slipRetentionDays ?? 30} /></Field>
    </FieldGroup>
    {qrPreview ? <div className="rounded-lg border p-4"><p className="mb-2 text-sm font-medium">PromptPay QR preview · ฿1.00</p><img src={qrPreview} width={192} height={192} alt="PromptPay QR preview" /></div> : null}
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="text-sm font-medium">LINE app identifiers</h3>
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field><div className="flex items-center gap-1"><FieldLabel htmlFor="line_liff_id">LIFF ID</FieldLabel><FieldHelp label="About LIFF ID">From the LIFF app configured for /line/connect.</FieldHelp></div><Input id="line_liff_id" name="line_liff_id" placeholder="1234567890-AbCdEf" defaultValue={initial?.lineLiffId} /></Field>
        <Field><div className="flex items-center gap-1"><FieldLabel htmlFor="line_login_channel_id">LINE Login channel ID</FieldLabel><FieldHelp label="About LINE Login channel ID">The numeric channel ID that owns the LIFF app.</FieldHelp></div><Input id="line_login_channel_id" name="line_login_channel_id" inputMode="numeric" placeholder="1234567890" defaultValue={initial?.lineLoginChannelId} /></Field>
      </FieldGroup>
    </div>
    <div className="grid gap-3 text-sm md:grid-cols-2">
      <label className="flex items-center gap-2"><input type="checkbox" name="ocr_enabled" defaultChecked={initial?.ocrEnabled ?? true} /> Enable slip OCR</label>
      <label className="flex items-center gap-2"><input type="checkbox" name="line_linking_enabled" defaultChecked={initial?.lineLinkingEnabled} disabled={!allowLineFeatures} /> Enable LINE linking</label>
      <label className="flex items-center gap-2"><input type="checkbox" name="line_messaging_enabled" defaultChecked={initial?.lineMessagingEnabled} disabled={!allowLineFeatures} /> Enable LINE messages</label>
      <label className="flex items-center gap-2"><input type="checkbox" name="line_chat_payments_enabled" defaultChecked={initial?.lineChatPaymentsEnabled} disabled={!allowLineFeatures} /> Enable LINE chat payments</label>
    </div>
    {!allowLineFeatures ? <p className="text-xs text-muted-foreground">Save and test both LINE credentials before enabling LINE features.</p> : null}
    <Button type="submit" size="lg" disabled={!qrPreview}>{submitLabel}</Button>
  </form>;
}
