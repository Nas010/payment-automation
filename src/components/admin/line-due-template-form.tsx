"use client";

import { useRef, useState, useTransition } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { LinePlaceholderEditor, type PlaceholderOption } from "@/components/admin/line-placeholder-editor";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
type CustomPlaceholderEditor = { originalName: string | null; name: string; template: string };

type Props = {
  profiles: ResolvedLineDueMessageProfiles;
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

export function LineDueTemplateForm({ profiles: initialProfiles, previewAction, saveAction, resetAction }: Props) {
  const [profiles, setProfiles] = useState<LineDueMessageProfiles>(() => Object.fromEntries(paymentTypes.map((paymentType) => [paymentType, initialProfiles[paymentType].kind === "VALID" ? structuredClone(initialProfiles[paymentType].profile) : structuredClone(DEFAULT_LINE_DUE_PROFILES[paymentType])])) as LineDueMessageProfiles);
  const [invalidByType, setInvalidByType] = useState<Record<LinePaymentType, boolean>>(() => Object.fromEntries(paymentTypes.map((paymentType) => [paymentType, initialProfiles[paymentType].kind === "INVALID"])) as Record<LinePaymentType, boolean>);
  const [activeType, setActiveType] = useState<LinePaymentType>("ONE_TIME");
  const [customEditorByType, setCustomEditorByType] = useState<Record<LinePaymentType, CustomPlaceholderEditor | null>>({ ONE_TIME: null, INSTALLMENTS: null });
  const [pendingRemoval, setPendingRemoval] = useState<{ paymentType: LinePaymentType; name: string } | null>(null);
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

  function removeCustom(paymentType: LinePaymentType, name: string): void {
    updateProfile(paymentType, (profile) => customIsReferenced(profile, name) ? profile : {
      ...profile,
      customPlaceholders: profile.customPlaceholders.filter((item) => item.name !== name),
    });
    setCustomEditorByType((current) => current[paymentType]?.originalName === name ? { ...current, [paymentType]: null } : current);
  }

  function addCustom(paymentType: LinePaymentType): void {
    const name = nextCustomName(profiles[paymentType]);
    setCustomEditorByType((current) => ({ ...current, [paymentType]: { originalName: null, name, template: "" } }));
  }

  function saveCustomEditor(paymentType: LinePaymentType): void {
    const editor = customEditorByType[paymentType];
    if (!editor) return;
    updateProfile(paymentType, (profile) => ({
      ...profile,
      customPlaceholders: editor.originalName === null
        ? [...profile.customPlaceholders, { name: editor.name, template: editor.template }]
        : profile.customPlaceholders.map((item) => item.name === editor.originalName ? { name: editor.name, template: editor.template } : item),
    }));
    setCustomEditorByType((current) => ({ ...current, [paymentType]: null }));
  }

  function previewCustomEditor(paymentType: LinePaymentType): void {
    const editor = customEditorByType[paymentType];
    if (!editor) return;
    const profile = profiles[paymentType];
    const previewProfile = {
      ...profile,
      customPlaceholders: editor.originalName === null
        ? [...profile.customPlaceholders, { name: editor.name, template: editor.template }]
        : profile.customPlaceholders.map((item) => item.name === editor.originalName ? { name: editor.name, template: editor.template } : item),
    };
    runProfileAction(previewAction, paymentType, "preview", "", previewProfile);
  }

  function runProfileAction(action: ProfileAction, paymentType: LinePaymentType, mode: "preview" | "save" | "reset", success: string, profile = profiles[paymentType]): void {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRequestPending(true);
    const submittedRevision = revisions.current[paymentType];
    const formData = profileFormData(paymentType, profile);
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

  return <>
    <Card>
    <CardHeader>
      <CardTitle>LINE due-payment messages</CardTitle>
      <CardDescription>Set separate messages for one-time payments and installments. Requires an amount, due date, and payment link.</CardDescription>
    </CardHeader>
    <CardContent>
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
          const customEditor = customEditorByType[paymentType];
          return <TabsContent key={paymentType} value={paymentType}>
            <FieldGroup className="mt-4">
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Custom placeholders</p>
                <div className="flex flex-wrap gap-2" aria-label="Custom placeholders">
                {profile.customPlaceholders.map((definition) => {
                  const referenced = customIsReferenced(profile, definition.name);
                  const isSelected = definition.name === customEditor?.originalName;
                  return <div key={`${paymentType}-${definition.name}`} className="relative">
                    <Button type="button" variant="outline" size="sm" className="pr-8" aria-label={`Edit placeholder ${definition.name}`} aria-pressed={isSelected} disabled={profileInvalid} onClick={() => setCustomEditorByType((current) => ({ ...current, [paymentType]: { originalName: definition.name, name: definition.name, template: definition.template } }))}>
                      {definition.name.replaceAll("_", " ")}
                    </Button>
                    <Button type="button" variant="ghost" size="icon-xs" className="absolute top-0.5 right-0.5 rounded-full" aria-label={`Remove ${definition.name}`} disabled={profileInvalid || referenced} onClick={() => setPendingRemoval({ paymentType, name: definition.name })}>
                      <XIcon />
                    </Button>
                  </div>;
                })}
                <Button type="button" variant="outline" size="sm" aria-label="Add placeholder" onClick={() => addCustom(paymentType)} disabled={profileInvalid || profile.customPlaceholders.length >= 20}>
                  <PlusIcon data-icon="inline-start" />
                  Add placeholder
                </Button>
              </div>
                </div>
              {customEditor ? <fieldset disabled={profileInvalid} className="rounded-md border p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Edit placeholder</p>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label="Close placeholder editor" onClick={() => setCustomEditorByType((current) => ({ ...current, [paymentType]: null }))}>
                    <XIcon />
                  </Button>
                </div>
                <FieldLabel htmlFor={`${paymentType}-${customEditor.name}-name`}>Custom placeholder</FieldLabel>
                <Input id={`${paymentType}-${customEditor.name}-name`} aria-label={`Placeholder name ${customEditor.name}`} value={customEditor.name} disabled={profileInvalid || (customEditor.originalName !== null && customIsReferenced(profile, customEditor.originalName))} onChange={(event) => setCustomEditorByType((current) => ({ ...current, [paymentType]: { ...customEditor, name: event.target.value } }))} />
                <div className="mt-3">
                  <LinePlaceholderEditor id={`${paymentType}-${customEditor.name}-template`} label={`Placeholder content ${customEditor.name}`} value={customEditor.template} placeholders={systemOptions} onChange={(template) => setCustomEditorByType((current) => ({ ...current, [paymentType]: { ...customEditor, template } }))} disabled={profileInvalid} />
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={profileInvalid || requestPending || pending} onClick={() => previewCustomEditor(paymentType)}>Preview placeholder</Button>
                  <Button type="button" variant="ghost" size="sm" aria-label="Cancel placeholder edits" onClick={() => setCustomEditorByType((current) => ({ ...current, [paymentType]: null }))}>Cancel</Button>
                  <Button type="button" size="sm" onClick={() => saveCustomEditor(paymentType)}>Save placeholder</Button>
                </div>
              </fieldset> : null}
              {profileInvalid ? <FieldDescription role="alert">Stored profile is invalid. Restore documented default before editing or sending.</FieldDescription> : null}
              <LinePlaceholderEditor id={`${paymentType}-message`} label={messageLabel} value={profile.message} placeholders={mainOptions} onChange={(message) => updateProfile(paymentType, (current) => ({ ...current, message }))} rows={10} disabled={profileInvalid} />
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
    </Card>
    <AlertDialog open={pendingRemoval !== null} onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {pendingRemoval?.name.replaceAll("_", " ")}?</AlertDialogTitle>
          <AlertDialogDescription>This removes the placeholder from this payment message profile. You can add it again later.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => {
            if (pendingRemoval) removeCustom(pendingRemoval.paymentType, pendingRemoval.name);
            setPendingRemoval(null);
          }}>Remove placeholder</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
