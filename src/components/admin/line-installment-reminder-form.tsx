"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { LinePlaceholderEditor, type PlaceholderOption } from "@/components/admin/line-placeholder-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  REMINDER_SLOTS,
  lineDueTemplatePlaceholders,
  systemPlaceholders,
  type LineDueMessageProfile,
  type LineInstallmentReminderConfig,
  type ResolvedLineInstallmentReminderConfig,
  type ReminderSlot,
} from "@/lib/line/message-profile";

type Result = { ok: true; slot: ReminderSlot; config: LineInstallmentReminderConfig; preview: string; auditWarning?: string };
type Props = {
  resolved: ResolvedLineInstallmentReminderConfig;
  previewAction: (formData: FormData) => Promise<Result>;
  saveAction: (formData: FormData) => Promise<Result>;
  resetAction: () => Promise<Result>;
};

const labels: Record<ReminderSlot, string> = {
  T_MINUS_7_DAYS: "7 days before due date",
  T_MINUS_3_DAYS: "3 days before due date",
  T_MINUS_1_DAY: "1 day before due date",
  DUE_DATE: "On due date",
  T_PLUS_1_DAY: "1 day after due date",
};

const systemOptions: PlaceholderOption[] = systemPlaceholders("INSTALLMENTS")
  .map((name) => ({ name, label: name.replaceAll("_", " ") }));

function actionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function LineInstallmentReminderForm({ resolved, previewAction, saveAction, resetAction }: Props) {
  const [config, setConfig] = useState<LineInstallmentReminderConfig | null>(() =>
    resolved.kind === "VALID" ? structuredClone(resolved.config) : null,
  );
  const [activeSlot, setActiveSlot] = useState<ReminderSlot | null>(null);
  const [draftProfile, setDraftProfile] = useState<LineDueMessageProfile | null>(null);
  const [previewText, setPreviewText] = useState("");
  const [editorError, setEditorError] = useState("");
  const [requestPending, setRequestPending] = useState(false);
  const requestInFlight = useRef(false);

  if (!config) {
    return <Card>
      <CardHeader><CardTitle>Installment reminders</CardTitle></CardHeader>
      <CardContent>Stored reminder setup is invalid.</CardContent>
    </Card>;
  }

  const currentConfig = config;
  const actionsPending = requestPending;

  function startRequest(): boolean {
    if (requestInFlight.current) return false;
    requestInFlight.current = true;
    setRequestPending(true);
    return true;
  }

  function finishRequest(): void {
    requestInFlight.current = false;
    setRequestPending(false);
  }

  function closeEditor(): void {
    if (actionsPending) return;
    setActiveSlot(null);
    setDraftProfile(null);
    setPreviewText("");
    setEditorError("");
  }

  function openEditor(slot: ReminderSlot): void {
    if (actionsPending) return;
    setActiveSlot(slot);
    setDraftProfile(structuredClone(currentConfig.profiles[slot]));
    setPreviewText("");
    setEditorError("");
  }

  function updateDraft(update: (profile: LineDueMessageProfile) => LineDueMessageProfile): void {
    setDraftProfile((current) => current ? update(current) : current);
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

  function toggle(slot: ReminderSlot): void {
    if (!startRequest()) return;
    const previous = currentConfig;
    const next = {
      ...previous,
      enabled: { ...previous.enabled, [slot]: !previous.enabled[slot] },
    };
    setConfig(next);
    const formData = new FormData();
    formData.set("slot", slot);
    formData.set("config", JSON.stringify(next));
    void (async () => {
      try {
        const result = await saveAction(formData);
        setConfig(structuredClone(result.config));
        if (result.auditWarning) toast.warning(result.auditWarning);
        else toast.success("Reminder updated.");
      } catch (error) {
        setConfig(previous);
        toast.error(actionError(error, "Could not update reminder."));
      } finally {
        finishRequest();
      }
    })();
  }

  function preview(): void {
    if (!activeSlot || !draftProfile || !startRequest()) return;
    const slot = activeSlot;
    const profile = structuredClone(draftProfile);
    setEditorError("");
    setPreviewText("");
    const formData = new FormData();
    formData.set("slot", slot);
    formData.set("profile", JSON.stringify(profile));
    void (async () => {
      try {
        const result = await previewAction(formData);
        setPreviewText(result.preview);
      } catch (error) {
        setEditorError(actionError(error, "Could not preview reminder template."));
      } finally {
        finishRequest();
      }
    })();
  }

  function saveMessage(): void {
    if (!activeSlot || !draftProfile || !startRequest()) return;
    const slot = activeSlot;
    const profile = structuredClone(draftProfile);
    const next = {
      ...currentConfig,
      profiles: { ...currentConfig.profiles, [slot]: profile },
    };
    setEditorError("");
    const formData = new FormData();
    formData.set("slot", slot);
    formData.set("config", JSON.stringify(next));
    void (async () => {
      try {
        const result = await saveAction(formData);
        setConfig(structuredClone(result.config));
        setActiveSlot(null);
        setDraftProfile(null);
        setPreviewText("");
        setEditorError("");
        if (result.auditWarning) toast.warning(result.auditWarning);
        else toast.success("Reminder message saved.");
      } catch (error) {
        setEditorError(actionError(error, "Could not update reminder."));
      } finally {
        finishRequest();
      }
    })();
  }

  function reset(): void {
    if (!startRequest()) return;
    void (async () => {
      try {
        const result = await resetAction();
        setConfig(structuredClone(result.config));
        setActiveSlot(null);
        setDraftProfile(null);
        setPreviewText("");
        setEditorError("");
        toast.success("Reminder defaults restored.");
      } catch (error) {
        toast.error(actionError(error, "Could not update reminder."));
      } finally {
        finishRequest();
      }
    })();
  }

  const activeLabel = activeSlot ? labels[activeSlot] : "";
  const messageOptions = draftProfile ? [
    ...systemOptions,
    ...draftProfile.customPlaceholders.map(({ name }) => ({ name, label: name.replaceAll("_", " ") })),
  ] : systemOptions;

  return <Card>
    <CardHeader>
      <CardTitle>Installment reminders</CardTitle>
      <CardDescription>Global templates for every later installment. Disabled reminders are not sent. Placeholders are optional; every send includes payment QR.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <div className="flex flex-col">
        {REMINDER_SLOTS.map((slot, index) => <div key={slot} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
          <Field orientation="horizontal">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 justify-start"
              disabled={actionsPending}
              onClick={() => openEditor(slot)}
            >
              {labels[slot]}
            </Button>
            <Switch
              aria-label={`Send ${labels[slot]} reminder`}
              checked={currentConfig.enabled[slot]}
              disabled={actionsPending}
              onCheckedChange={() => toggle(slot)}
            />
          </Field>
          {index < REMINDER_SLOTS.length - 1 ? <Separator /> : null}
        </div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" disabled={actionsPending} onClick={reset}>Restore defaults</Button>
      </div>
    </CardContent>
    <Dialog open={activeSlot !== null} onOpenChange={(open) => { if (!open) closeEditor(); }}>
      <DialogContent showCloseButton={!actionsPending} className="h-[calc(100dvh-2rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:h-[min(42rem,calc(100dvh-2rem))] sm:max-w-2xl">
        <DialogHeader className="p-4 pr-10">
          <DialogTitle>Edit {activeLabel}</DialogTitle>
          <DialogDescription>Customize this reminder without changing the other send times.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 px-4">
          {draftProfile ? <FieldGroup className="pb-4">
            {draftProfile.customPlaceholders.map((definition, index) => {
              const referenced = customIsReferenced(draftProfile, definition.name);
              return <FieldGroup key={`${activeSlot}-${index}`} className="rounded-lg border p-3">
                <FieldLabel htmlFor={`${activeSlot}-${index}-name`}>Custom placeholder</FieldLabel>
                <Input
                  id={`${activeSlot}-${index}-name`}
                  aria-label={`${activeLabel} placeholder name ${definition.name}`}
                  value={definition.name}
                  disabled={referenced || actionsPending}
                  onChange={(event) => updateDraft((profile) => ({
                    ...profile,
                    customPlaceholders: profile.customPlaceholders.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item),
                  }))}
                />
                <LinePlaceholderEditor
                  id={`${activeSlot}-${index}-template`}
                  label={`${activeLabel} placeholder content ${definition.name}`}
                  value={definition.template}
                  placeholders={systemOptions}
                  disabled={actionsPending}
                  onChange={(template) => updateDraft((profile) => ({
                    ...profile,
                    customPlaceholders: profile.customPlaceholders.map((item, itemIndex) => itemIndex === index ? { ...item, template } : item),
                  }))}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove ${definition.name} from ${activeLabel}`}
                    disabled={referenced || actionsPending}
                    onClick={() => updateDraft((profile) => ({
                      ...profile,
                      customPlaceholders: profile.customPlaceholders.filter((item) => item.name !== definition.name),
                    }))}
                  >
                    Remove
                  </Button>
                  {referenced ? <FieldDescription>Remove it from message before renaming or deleting.</FieldDescription> : null}
                </div>
              </FieldGroup>;
            })}
            <Button
              type="button"
              variant="outline"
              aria-label={`Add placeholder to ${activeLabel}`}
              disabled={actionsPending || draftProfile.customPlaceholders.length >= 20}
              onClick={() => updateDraft((profile) => ({
                ...profile,
                customPlaceholders: [...profile.customPlaceholders, { name: nextCustomName(profile), template: "" }],
              }))}
            >
              Add placeholder
            </Button>
            <LinePlaceholderEditor
              id={`${activeSlot}-message`}
              label={`${activeLabel} message`}
              value={draftProfile.message}
              placeholders={messageOptions}
              disabled={actionsPending}
              onChange={(message) => updateDraft((profile) => ({ ...profile, message }))}
              rows={7}
            />
            {previewText ? <pre className="whitespace-pre-wrap rounded-lg border p-3 text-sm">{previewText}</pre> : null}
            <FieldError>{editorError}</FieldError>
          </FieldGroup> : null}
        </ScrollArea>
        <DialogFooter className="mx-0 mb-0">
          <Button type="button" variant="ghost" disabled={actionsPending} onClick={reset}>Restore defaults</Button>
          <Button type="button" variant="outline" disabled={actionsPending} onClick={closeEditor}>Cancel</Button>
          <Button type="button" variant="outline" disabled={actionsPending} onClick={preview}>Preview</Button>
          <Button type="button" disabled={actionsPending} onClick={saveMessage}>Save message</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
}
