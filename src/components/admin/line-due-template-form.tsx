"use client";

import { useRef, useState, useTransition } from "react";
import { LinePlaceholderEditor, type PlaceholderOption } from "@/components/admin/line-placeholder-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  lineDueTemplatePlaceholders,
  systemPlaceholders,
  type LineDueMessageProfile,
  type LineDueMessageProfileActionResult,
  type LineDueMessageProfiles,
  type LinePaymentType,
  type ResolvedLineDueMessageProfiles,
  DEFAULT_LINE_DUE_PROFILES,
} from "@/lib/line/message-profile";

type ProfileAction = (formData: FormData) => Promise<LineDueMessageProfileActionResult>;

type Props = {
  profiles: ResolvedLineDueMessageProfiles;
  messagingEnabled: boolean;
  chatPaymentsEnabled: boolean;
  previewAction: ProfileAction;
  saveAction: ProfileAction;
  resetAction: ProfileAction;
};

const paymentTypes = ["ONE_TIME", "INSTALLMENTS"] as const;

function profileFormData(paymentType: LinePaymentType, profile: LineDueMessageProfile): FormData {
  const formData = new FormData();
  formData.set("payment_type", paymentType);
  formData.set("profile", JSON.stringify(profile));
  return formData;
}

function optionsFor(paymentType: LinePaymentType): PlaceholderOption[] {
  return systemPlaceholders(paymentType).map((name) => ({ name, label: name.replaceAll("_", " ") }));
}

export function LineDueTemplateForm({ profiles: initialProfiles, messagingEnabled, chatPaymentsEnabled, previewAction, saveAction, resetAction }: Props) {
  const [profiles, setProfiles] = useState<LineDueMessageProfiles>(() => Object.fromEntries(paymentTypes.map((paymentType) => [paymentType, initialProfiles[paymentType].kind === "VALID" ? structuredClone(initialProfiles[paymentType].profile) : structuredClone(DEFAULT_LINE_DUE_PROFILES[paymentType])])) as LineDueMessageProfiles);
  const [invalidByType, setInvalidByType] = useState<Record<LinePaymentType, boolean>>(() => Object.fromEntries(paymentTypes.map((paymentType) => [paymentType, initialProfiles[paymentType].kind === "INVALID"])) as Record<LinePaymentType, boolean>);
  const [activeType, setActiveType] = useState<LinePaymentType>("ONE_TIME");
  const [previewByType, setPreviewByType] = useState<Record<LinePaymentType, string>>({ ONE_TIME: "", INSTALLMENTS: "" });
  const [outcomeByType, setOutcomeByType] = useState<Record<LinePaymentType, string>>({ ONE_TIME: "", INSTALLMENTS: "" });
  const [requestPending, setRequestPending] = useState(false);
  const requestInFlight = useRef(false);
  const revisions = useRef<Record<LinePaymentType, number>>({ ONE_TIME: 0, INSTALLMENTS: 0 });
  const [pending, startTransition] = useTransition();

  function updateProfile(paymentType: LinePaymentType, update: (profile: LineDueMessageProfile) => LineDueMessageProfile): void {
    revisions.current[paymentType] += 1;
    setProfiles((current) => ({ ...current, [paymentType]: update(current[paymentType]) }));
  }

  function customIsReferenced(profile: LineDueMessageProfile, name: string): boolean {
    try {
      return lineDueTemplatePlaceholders(profile.message).includes(name);
    } catch {
      return true;
    }
  }

  function nextCustomName(profile: LineDueMessageProfile): string {
    const used = new Set(profile.customPlaceholders.map((item) => item.name));
    let index = 1;
    while (used.has(`custom_${index}`)) index += 1;
    return `custom_${index}`;
  }

  function updateCustomTemplate(paymentType: LinePaymentType, name: string, template: string): void {
    updateProfile(paymentType, (profile) => ({
      ...profile,
      customPlaceholders: profile.customPlaceholders.map((item) => item.name === name ? { ...item, template } : item),
    }));
  }

  function renameCustom(paymentType: LinePaymentType, index: number, name: string): void {
    updateProfile(paymentType, (profile) => ({
      ...profile,
      customPlaceholders: profile.customPlaceholders.map((item, itemIndex) => itemIndex === index ? { ...item, name } : item),
    }));
  }

  function removeCustom(paymentType: LinePaymentType, name: string): void {
    updateProfile(paymentType, (profile) => customIsReferenced(profile, name) ? profile : {
      ...profile,
      customPlaceholders: profile.customPlaceholders.filter((item) => item.name !== name),
    });
  }

  function addCustom(paymentType: LinePaymentType): void {
    updateProfile(paymentType, (profile) => ({
      ...profile,
      customPlaceholders: [...profile.customPlaceholders, { name: nextCustomName(profile), template: "" }],
    }));
  }

  function runProfileAction(action: ProfileAction, paymentType: LinePaymentType, mode: "preview" | "save" | "reset", success: string): void {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRequestPending(true);
    const submittedRevision = revisions.current[paymentType];
    const formData = profileFormData(paymentType, profiles[paymentType]);
    setOutcomeByType((current) => ({ ...current, [paymentType]: "" }));
    void (async () => {
      try {
        const result = await action(formData);
        startTransition(() => {
          if (mode !== "preview" && revisions.current[result.paymentType] === submittedRevision) {
            setProfiles((current) => ({ ...current, [result.paymentType]: result.profile }));
            setInvalidByType((current) => ({ ...current, [result.paymentType]: false }));
          }
          setPreviewByType((current) => ({ ...current, [result.paymentType]: result.preview }));
          setOutcomeByType((current) => ({ ...current, [result.paymentType]: success }));
        });
      } catch (error) {
        startTransition(() => {
          setOutcomeByType((current) => ({ ...current, [paymentType]: error instanceof Error ? error.message : "Could not update LINE message profile." }));
        });
      } finally {
        requestInFlight.current = false;
        setRequestPending(false);
      }
    })();
  }

  return <Card>
    <CardHeader>
      <CardTitle>LINE due-payment messages</CardTitle>
      <CardDescription>Set separate messages for one-time payments and installments. Required: amount, due_date, payment_url.</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="mb-4 flex flex-wrap gap-2 text-sm text-muted-foreground">
        <span>{messagingEnabled ? "LINE messaging enabled" : "LINE messaging disabled"}</span>
        <span>{chatPaymentsEnabled ? "LINE chat payments enabled" : "LINE chat payments disabled"}</span>
      </div>
      <Tabs value={activeType} onValueChange={(value) => setActiveType(value === "INSTALLMENTS" ? "INSTALLMENTS" : "ONE_TIME")}>
        <TabsList>
          <TabsTrigger value="ONE_TIME">One-time payment</TabsTrigger>
          <TabsTrigger value="INSTALLMENTS">Installments</TabsTrigger>
        </TabsList>
        {paymentTypes.map((paymentType) => {
          const profile = profiles[paymentType];
          const profileInvalid = invalidByType[paymentType];
          const systemOptions = optionsFor(paymentType);
          const mainOptions = [...systemOptions, ...profile.customPlaceholders.map(({ name }) => ({ name, label: name.replaceAll("_", " ") }))];
          const messageLabel = paymentType === "ONE_TIME" ? "One-time payment message" : "Installment payment message";
          return <TabsContent key={paymentType} value={paymentType}>
            <FieldGroup className="mt-4">
              {profile.customPlaceholders.map((definition, index) => {
                const referenced = customIsReferenced(profile, definition.name);
                return <fieldset key={`${paymentType}-${index}`} disabled={profileInvalid} className="rounded-md border p-3">
                  <FieldLabel htmlFor={`${paymentType}-${index}-name`}>Custom placeholder</FieldLabel>
                  <Input id={`${paymentType}-${index}-name`} aria-label={`Placeholder name ${definition.name}`} value={definition.name} disabled={profileInvalid || referenced} onChange={(event) => renameCustom(paymentType, index, event.target.value)} />
                  <div className="mt-3">
                    <LinePlaceholderEditor id={`${paymentType}-${index}-template`} label={`Placeholder content ${definition.name}`} value={definition.template} placeholders={systemOptions} onChange={(template) => updateCustomTemplate(paymentType, definition.name, template)} disabled={profileInvalid} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button type="button" variant="ghost" aria-label={`Remove ${definition.name}`} disabled={profileInvalid || referenced} onClick={() => removeCustom(paymentType, definition.name)}>Remove</Button>
                    {referenced ? <FieldDescription>Remove it from the message before renaming or deleting.</FieldDescription> : null}
                  </div>
                </fieldset>;
              })}
              {profileInvalid ? <FieldDescription role="alert">Stored profile is invalid. Restore documented default before editing or sending.</FieldDescription> : null}
              <Button type="button" variant="outline" onClick={() => addCustom(paymentType)} disabled={profileInvalid || profile.customPlaceholders.length >= 20}>Add placeholder</Button>
              <LinePlaceholderEditor id={`${paymentType}-message`} label={messageLabel} value={profile.message} placeholders={mainOptions} onChange={(message) => updateProfile(paymentType, (current) => ({ ...current, message }))} rows={10} disabled={profileInvalid} />
              <FieldDescription>Message limit: 5,000 characters after substitution. Custom placeholders may use system placeholders only.</FieldDescription>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" disabled={profileInvalid || requestPending || pending} onClick={() => runProfileAction(previewAction, paymentType, "preview", "")}>Preview message</Button>
                <Button type="button" disabled={profileInvalid || requestPending || pending} onClick={() => runProfileAction(saveAction, paymentType, "save", "Profile saved.")}>Save profile</Button>
                <Button type="button" variant="ghost" disabled={requestPending || pending} onClick={() => runProfileAction(resetAction, paymentType, "reset", "Documented default restored.")}>Restore default</Button>
              </div>
              {previewByType[paymentType] ? <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{previewByType[paymentType]}</pre> : null}
              {outcomeByType[paymentType] ? <p className="text-sm" aria-live="polite">{outcomeByType[paymentType]}</p> : null}
            </FieldGroup>
          </TabsContent>;
        })}
      </Tabs>
    </CardContent>
  </Card>;
}
