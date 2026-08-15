# Reminder Toggles and Focused Editor Design

**Status:** Approved
**Date:** 2026-08-16

## Goal

Let the coach enable or disable each installment-reminder timing independently and edit one reminder in a focused overlay. A disabled reminder must not start a new LINE delivery attempt, including a retry attempt, while it remains disabled.

## Scope

- Keep the five fixed reminder slots: T−7 days, T−3 days, T−1 day, due date, and T+1 day.
- Add one persisted enabled flag per slot. No master switch and no client-level overrides.
- Replace the five expanded editors with a compact reminder list.
- Keep existing template, custom-placeholder, validation, preview, reset, and LINE delivery behavior unless this design changes it explicitly.

## Reminder List

The **Installment reminders** card contains five compact rows in chronological order. Each row contains only:

1. A human-readable reminder name, such as **7 days before due date**.
2. A settings switch for that reminder.

There is no enabled/paused badge, message excerpt, or separate Edit button. The reminder name is an accessible button that opens its editor. It has normal hover, keyboard-focus, and disabled-request states. The switch is a separate control; operating it never opens the editor.

The card description explains that disabled reminders are not sent. Existing **Restore defaults** remains a card-level action.

## Toggle Behavior

Changing a switch immediately submits the complete persisted reminder configuration with only that slot's enabled flag changed. Template drafts are not part of toggle requests.

- While the request is pending, reminder actions are disabled to prevent overlapping settings writes.
- Success updates the persisted client state and shows a Sonner confirmation.
- Failure restores the prior switch value and shows a safe error toast.
- Restore defaults restores documented messages, removes custom edits, and enables all five slots.

A disabled slot stays in the operational configuration; its profile is preserved and remains editable. Disabling does not change existing per-payment delivery logs.

## Focused Editor

Pressing a reminder name opens a responsive shadcn `Dialog`. The dialog has an accessible title and description naming the selected timing. It uses a wide desktop layout and a bounded scroll region so header and footer actions remain available with long custom-placeholder content.

The editor owns a draft clone of only the selected profile. It presents:

1. Custom-placeholder definitions, when present, plus **Add placeholder**.
2. Available system and custom placeholder insertion controls directly above the main message textarea through the existing `LinePlaceholderEditor` pattern.
3. **Preview** and the server-rendered preview result below the message editor.
4. A sticky footer with **Cancel** and **Save message**.

Closing or cancelling discards the draft. Saving submits the current persisted full configuration with only the selected profile replaced by its validated draft. A successful save updates the list state, closes the dialog, and shows a confirmation toast. A validation or settings-write failure leaves the dialog and draft open, surfaces the safe error inside the dialog, and performs no partial write.

The preview action continues submitting only the selected profile. It does not save either the message or enabled state.

## Components and Styling

Use the project's existing Base UI shadcn `base-nova` system, Tailwind v4 semantic tokens, Geist type, neutral theme, Lucide icons, and compact settings density.

- Existing: `Card`, `Dialog`, `Field`, `Button`, `Separator`, `Textarea`, and Sonner.
- Add from the official shadcn registry: `Switch` and `ScrollArea`.
- Use `Field`/`FieldGroup` for form structure, `DialogTitle` and `DialogDescription` for accessibility, and existing component variants instead of custom colors.
- Use Tailwind only for layout and responsive sizing. Do not add a new theme or page-specific palette.

## Configuration and Compatibility

Introduce a normalized version 2 configuration:

```ts
type LineInstallmentReminderConfig = {
  version: 2;
  enabled: Record<ReminderSlot, boolean>;
  profiles: Record<ReminderSlot, LineDueMessageProfile>;
};
```

The parser accepts stored version 1 and version 2 values. Version 1 values normalize in memory to version 2 with every slot enabled. Legacy due-profile fallback also resolves to version 2 with every slot enabled. No compatibility read writes Settings automatically; the next successful toggle, message save, or restore writes version 2.

Version 2 requires exactly the five known keys in both `enabled` and `profiles`, rejects non-boolean enabled values, and rejects unexpected slot keys. Existing profile validation remains unchanged.

## Delivery Safety

The reminder sender checks the selected slot's enabled flag before recipient resolution, template rendering, delivery-log mutation, LINE API calls, and audit writes. Disabled slots are excluded from both scheduled attempts and `FAILED_RETRYABLE` retries.

Re-enabling restores normal eligibility:

- A scheduled date missed while disabled is not backfilled because the existing scheduler sends only on the slot date.
- A previously recorded retryable attempt may resume after re-enable using its existing frozen message and retry key.
- Accepted deliveries remain accepted and never resend.

Turning a reminder off cannot recall a LINE request that was already sent before the settings save completed. After the disabled configuration is observed, the application starts no new attempt for that slot.

## Server Actions and Audit

Preview remains profile-only. Toggle and message-save actions authenticate first, parse and validate the complete submitted configuration, perform one settings upsert, and append the existing reminder-configuration audit event without message text or client data.

The client keeps persisted configuration separate from the active modal draft. This prevents an immediate toggle from accidentally saving unfinished message edits and prevents a successful toggle response from overwriting an open draft.

## Error Handling

- Invalid stored version 1 or version 2 configuration keeps the existing invalid-setup state and sends no reminders.
- Toggle failures revert visible state and show a generic safe fallback when no safe error message exists.
- Preview failures stay inside the selected editor.
- Save failures keep the editor open with its draft intact.
- Request locking prevents overlapping toggle, preview, save, and restore writes.

## Testing

- Parser tests cover valid version 2, version 1 normalization, missing or unexpected enabled keys, and non-boolean flags.
- Settings-resolution tests cover version 1 and legacy-profile compatibility with all slots enabled.
- Sender tests prove a disabled scheduled slot and disabled retryable slot perform no recipient, render, state-write, audit, or LINE send work.
- Sender tests retain normal sending after re-enable, no backfill of missed dates, retry resumption, and accepted-delivery deduplication.
- Action tests cover atomic toggle/message saves, authentication, validation failure, and content-free audit metadata.
- Component tests cover five compact rows, no badge/excerpt/Edit button, reminder-name dialog trigger, independent switch interaction, toggle rollback, modal draft isolation, placeholder controls above the message textarea, preview, save, cancel, and restore defaults.
- Run affected Vitest suites during implementation, then `npm run lint`, `npm test`, and `npm run build`.

## Non-Goals

- Master toggle, per-client overrides, arbitrary reminder timings, drag-and-drop ordering, bulk editing, delivery-history UI, or changes to one-time and first-installment payment requests.
- Backfilling reminders missed while a slot was disabled.
- Cancelling a LINE request already submitted before a disable save completed.
