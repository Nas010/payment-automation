"use client";

import { useRef, useState, useTransition } from "react";
import { LinePlaceholderEditor, type PlaceholderOption } from "@/components/admin/line-placeholder-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  REMINDER_SLOTS,
  lineDueTemplatePlaceholders,
  systemPlaceholders,
  type LineDueMessageProfile,
  type LineInstallmentReminderConfig,
  type ResolvedLineInstallmentReminderConfig,
  type ReminderSlot,
} from "@/lib/line/message-profile";

type Result = { ok: true; slot: ReminderSlot; config: LineInstallmentReminderConfig; preview: string };
type Props = {
  resolved: ResolvedLineInstallmentReminderConfig;
  previewAction: (formData: FormData) => Promise<Result>;
  saveAction: (formData: FormData) => Promise<Result>;
  resetAction: () => Promise<Result>;
};

const labels: Record<ReminderSlot, string> = {
  T_MINUS_7_DAYS: "T−7 days",
  T_MINUS_3_DAYS: "T−3 days",
  T_MINUS_1_DAY: "T−1 day",
  DUE_DATE: "Due date",
  T_PLUS_1_DAY: "T+1 day",
};

const systemOptions: PlaceholderOption[] = systemPlaceholders("INSTALLMENTS")
  .map((name) => ({ name, label: name.replaceAll("_", " ") }));

function emptySlotStrings(): Record<ReminderSlot, string> {
  return Object.fromEntries(REMINDER_SLOTS.map((slot) => [slot, ""])) as Record<ReminderSlot, string>;
}

function emptySlotNumbers(): Record<ReminderSlot, number> {
  return Object.fromEntries(REMINDER_SLOTS.map((slot) => [slot, 0])) as Record<ReminderSlot, number>;
}

function actionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function LineInstallmentReminderForm({ resolved, previewAction, saveAction, resetAction }: Props) {
  const [config, setConfig] = useState<LineInstallmentReminderConfig | null>(() =>
    resolved.kind === "VALID" ? structuredClone(resolved.config) : null,
  );
  const [previewBySlot, setPreviewBySlot] = useState<Record<ReminderSlot, string>>(emptySlotStrings);
  const [outcomeBySlot, setOutcomeBySlot] = useState<Record<ReminderSlot, string>>(emptySlotStrings);
  const [formOutcome, setFormOutcome] = useState("");
  const [requestPending, setRequestPending] = useState(false);
  const requestInFlight = useRef(false);
  const revisions = useRef<Record<ReminderSlot, number>>(emptySlotNumbers());
  const [pending, startTransition] = useTransition();

  if (!config) {
    return <Card>
      <CardHeader><CardTitle>Installment reminders</CardTitle></CardHeader>
      <CardContent>Stored reminder setup is invalid.</CardContent>
    </Card>;
  }
  const currentConfig = config;

  function updateProfile(slot: ReminderSlot, update: (profile: LineDueMessageProfile) => LineDueMessageProfile): void {
    revisions.current[slot] += 1;
    setConfig((current) => current ? {
      ...current,
      profiles: { ...current.profiles, [slot]: update(current.profiles[slot]) },
    } : current);
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

  function updateCustomTemplate(slot: ReminderSlot, name: string, template: string): void {
    updateProfile(slot, (profile) => ({
      ...profile,
      customPlaceholders: profile.customPlaceholders.map((item) => item.name === name ? { ...item, template } : item),
    }));
  }

  function renameCustom(slot: ReminderSlot, index: number, name: string): void {
    updateProfile(slot, (profile) => ({
      ...profile,
      customPlaceholders: profile.customPlaceholders.map((item, itemIndex) => itemIndex === index ? { ...item, name } : item),
    }));
  }

  function removeCustom(slot: ReminderSlot, name: string): void {
    updateProfile(slot, (profile) => customIsReferenced(profile, name) ? profile : {
      ...profile,
      customPlaceholders: profile.customPlaceholders.filter((item) => item.name !== name),
    });
  }

  function addCustom(slot: ReminderSlot): void {
    updateProfile(slot, (profile) => ({
      ...profile,
      customPlaceholders: [...profile.customPlaceholders, { name: nextCustomName(profile), template: "" }],
    }));
  }

  function preview(slot: ReminderSlot): void {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRequestPending(true);
    setOutcomeBySlot((current) => ({ ...current, [slot]: "" }));
    const formData = new FormData();
    formData.set("slot", slot);
    formData.set("profile", JSON.stringify(currentConfig.profiles[slot]));
    void (async () => {
      try {
        const result = await previewAction(formData);
        startTransition(() => {
          setPreviewBySlot((current) => ({ ...current, [result.slot]: result.preview }));
        });
      } catch (error) {
        startTransition(() => {
          setOutcomeBySlot((current) => ({
            ...current,
            [slot]: actionError(error, "Could not preview reminder template."),
          }));
        });
      } finally {
        requestInFlight.current = false;
        setRequestPending(false);
      }
    })();
  }

  function save(): void {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRequestPending(true);
    setFormOutcome("");
    const submittedRevisions = { ...revisions.current };
    const formData = new FormData();
    formData.set("slot", "DUE_DATE");
    formData.set("config", JSON.stringify(currentConfig));
    void (async () => {
      try {
        const result = await saveAction(formData);
        startTransition(() => {
          const unchanged = REMINDER_SLOTS.every((slot) => revisions.current[slot] === submittedRevisions[slot]);
          if (unchanged) setConfig(result.config);
          setPreviewBySlot((current) => ({ ...current, [result.slot]: result.preview }));
          setFormOutcome("Reminder templates saved.");
        });
      } catch (error) {
        startTransition(() => setFormOutcome(actionError(error, "Could not save reminder templates.")));
      } finally {
        requestInFlight.current = false;
        setRequestPending(false);
      }
    })();
  }

  function reset(): void {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRequestPending(true);
    setFormOutcome("");
    void (async () => {
      try {
        const result = await resetAction();
        startTransition(() => {
          revisions.current = emptySlotNumbers();
          setConfig(result.config);
          setPreviewBySlot((current) => ({ ...current, [result.slot]: result.preview }));
          setFormOutcome("Documented defaults restored.");
        });
      } catch (error) {
        startTransition(() => setFormOutcome(actionError(error, "Could not restore reminder templates.")));
      } finally {
        requestInFlight.current = false;
        setRequestPending(false);
      }
    })();
  }

  const actionsPending = requestPending || pending;

  return <Card>
    <CardHeader>
      <CardTitle>Installment reminders</CardTitle>
      <CardDescription>Global templates for every later installment. Placeholders are optional; every send includes the payment QR.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      {REMINDER_SLOTS.map((slot) => {
        const label = labels[slot];
        const profile = config.profiles[slot];
        const messageOptions = [
          ...systemOptions,
          ...profile.customPlaceholders.map(({ name }) => ({ name, label: name.replaceAll("_", " ") })),
        ];
        return <fieldset key={slot} className="space-y-4 rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">{label}</legend>
          {profile.customPlaceholders.map((definition, index) => {
            const referenced = customIsReferenced(profile, definition.name);
            return <fieldset key={`${slot}-${index}`} className="space-y-3 rounded-md border p-3">
              <FieldLabel htmlFor={`${slot}-${index}-name`}>Custom placeholder</FieldLabel>
              <Input
                id={`${slot}-${index}-name`}
                aria-label={`${label} placeholder name ${definition.name}`}
                value={definition.name}
                disabled={referenced}
                onChange={(event) => renameCustom(slot, index, event.target.value)}
              />
              <LinePlaceholderEditor
                id={`${slot}-${index}-template`}
                label={`${label} placeholder content ${definition.name}`}
                value={definition.template}
                placeholders={systemOptions}
                onChange={(template) => updateCustomTemplate(slot, definition.name, template)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" aria-label={`Remove ${definition.name} from ${label}`} disabled={referenced} onClick={() => removeCustom(slot, definition.name)}>Remove</Button>
                {referenced ? <FieldDescription>Remove it from the message before renaming or deleting.</FieldDescription> : null}
              </div>
            </fieldset>;
          })}
          <Button
            type="button"
            variant="outline"
            aria-label={`Add placeholder to ${label}`}
            disabled={profile.customPlaceholders.length >= 20}
            onClick={() => addCustom(slot)}
          >Add placeholder</Button>
          <LinePlaceholderEditor
            id={`${slot}-message`}
            label={`${label} message`}
            value={profile.message}
            placeholders={messageOptions}
            onChange={(message) => updateProfile(slot, (current) => ({ ...current, message }))}
            rows={7}
          />
          <Button type="button" variant="outline" aria-label={`Preview ${label} message`} disabled={actionsPending} onClick={() => preview(slot)}>Preview</Button>
          {previewBySlot[slot] ? <pre className="whitespace-pre-wrap rounded border p-3 text-sm">{previewBySlot[slot]}</pre> : null}
          {outcomeBySlot[slot] ? <p className="text-sm" aria-live="polite">{outcomeBySlot[slot]}</p> : null}
        </fieldset>;
      })}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={actionsPending} onClick={save}>Save reminder templates</Button>
        <Button type="button" variant="ghost" disabled={actionsPending} onClick={reset}>Restore defaults</Button>
      </div>
      {formOutcome ? <p className="text-sm" aria-live="polite">{formOutcome}</p> : null}
    </CardContent>
  </Card>;
}
