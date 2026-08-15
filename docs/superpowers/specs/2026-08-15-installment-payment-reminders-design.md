# Installment Payment Reminders

**Status:** Implemented
**Date:** 2026-08-15

## Goal

Let the coach configure a global, fixed reminder sequence for unpaid later installments. Every reminder includes its payment URL and PromptPay QR. The payment due date is the deadline, not the first payment-contact date.

## Scope

- Apply reminders only to installment payments after the initial installment (`installment_number > 1`).
- Do not create a reminder sequence for one-time payments or initial installment payments. Instead, create their payment links and send their payment request (text plus QR) immediately when their schedule is created.
- Use exactly five Bangkok-calendar slots:
  - `T_MINUS_7_DAYS`
  - `T_MINUS_3_DAYS`
  - `T_MINUS_1_DAY`
  - `DUE_DATE`
  - `T_PLUS_1_DAY`
- Use one global configuration for all clients. There are no client-level overrides and no per-slot enable/disable controls.

## Timing and Payment Links

When a one-time payment or initial installment schedule is created, the application immediately creates its Payment row, public payment URL, and QR-capable LINE payment request. This is an immediate-payment send, not a reminder, and does not wait for the future due date. It reuses the current one-time or initial-installment message selection, including the applicable first-payment terms image behavior.

For a later installment that is at least seven days away, the scheduled cron run on T-7 creates its Payment row, public payment URL, and QR-capable payment request. That same run sends the T-7 reminder.

For a later installment created fewer than seven days before its due date, the system creates its Payment row and payment URL immediately. It does not send old reminder slots. It sends the next upcoming slot only, if the payment remains unpaid. For example, a payment created two days before its deadline first sends at T-1.

Each installment has exactly one Payment row, public payment URL, and exact-amount QR image. The first creation—at T-7 or immediately for a late-created installment—is canonical. Every reminder in that installment's sequence reuses the same URL, public token, and QR image; no reminder creates or rotates a payment link.

An installment created after T+1 receives no backfilled reminder. All reminder eligibility uses Bangkok date keys and the existing daily cron route.

Each eligible slot sends:

1. Its configured text message, rendered from payment and client data.
2. The exact-payment PromptPay QR image.

The existing due-date LINE delivery becomes the `DUE_DATE` reminder for applicable later installments. It must not emit a second due-date message.

## Configuration and Admin Experience

Add one versioned operational Settings JSON value, `line_installment_reminder_config`:

```ts
type LineInstallmentReminderConfig = {
  version: 1;
  profiles: Record<ReminderSlot, LineDueMessageProfile>;
};
```

`ReminderSlot` is the five fixed keys above. Each profile uses the existing `LineDueMessageProfile` model: one main message and zero or more custom placeholders. Custom placeholders are local to their own reminder slot.

The existing one-time message profile stays available for the immediate one-time workflow. The single installment-message editor becomes an **Installment reminders** editor with five fixed sections, one for each slot. Each section provides:

- independent main template and custom placeholders;
- protected installment placeholders already supported by the existing renderer;
- server-rendered safe preview;
- field-specific validation;
- local reset to that slot's default.

One save validates every slot and writes the entire reminder configuration in one Settings update. Therefore a failed validation or Sheets write retains the prior complete configuration.

Every reminder template must reference `amount`, `due_date`, and `payment_url`, directly or through a custom placeholder. The QR image is attached by delivery code and is not a template placeholder.

When the new configuration does not exist, reads resolve a compatibility configuration without writing Settings: the current installment profile supplies the `DUE_DATE` template, while the four other slots receive explicit safe defaults. The first successful reminder-config save writes the new value.

## Per-Payment Delivery State

Append one `line_reminder_delivery_log` column to Payments. It stores a versioned JSON object keyed by reminder slot. Each slot records only delivery state needed for safe retries:

```ts
type ReminderDelivery = {
  status: "PENDING" | "SENDING" | "ACCEPTED" | "FAILED_RETRYABLE" | "FAILED" | "SKIPPED_MISSING_USER_ID" | "REVIEW";
  renderedMessage?: string;
  retryKey?: string;
  firstAttemptedAt?: string;
  acceptedAt?: string;
  requestId?: string;
  errorCode?: string;
};
```

The sender freezes `renderedMessage` and `retryKey` before the first LINE attempt. A retry sends exactly the frozen text with the same retry key. Once a slot is accepted, the log retains acceptance identity but can discard rendered text; it never renders or sends that slot again.

The sender considers only Payments with status `PENDING`. Recorded or manually confirmed payments, review-state payments, and other non-pending states receive no future reminders. The eligibility loop skips accepted slots and slot dates before payment creation; it does not backfill them.

Legacy `line_message_*` data remains compatible. An existing accepted legacy due-date message counts as an accepted `DUE_DATE` delivery for deduplication; migration never re-sends it. The reminder log starts empty for old rows and no migration itself generates payments or sends LINE messages.

## Delivery, Failures, and Audit

Extend the existing LINE due-payment sender rather than adding a second integration path. Reuse its recipient checks, rendering, LINE push client, QR generation, retry-key handling, ambiguous-acceptance protection, and safe error codes.

- A missing linked LINE recipient records `SKIPPED_MISSING_USER_ID` for only that slot. A later eligible slot may send if the client links LINE in time.
- Invalid stored templates or unavailable template data record a retryable slot failure and send no partial request.
- Retryable transport failures retain the frozen message and retry key.
- Ambiguous delivery acceptance after the existing safety window moves that slot to `REVIEW`; it is never blindly retried.
- Persisted state and audit writes remain independent, as in current flow. Audit metadata includes payment ID, slot, status, and LINE request/error code only—never message text, QR data, URLs, or private client data.

Add reminder-specific audit actions while preserving current due-message audit compatibility. One accepted reminder produces one text-and-QR delivery audit outcome.

## Code Boundaries

- `src/lib/line/message-profile.ts`: reuse profile parsing, placeholder validation, and rendering; add fixed reminder-config parsing/default resolution.
- `src/components/admin/line-due-template-form.tsx`: extend existing editor controls for five installment reminder sections; retain one-time editor behavior.
- `src/app/admin/(protected)/settings/line-actions.ts`: validate, preview, reset, and atomically save reminder configuration.
- `src/lib/payments/generate.ts` and schedule helpers: make later-installment Payments available at T-7 or immediately when created late, without affecting initial/one-time behavior.
- Client/package/manual-payment actions: create and send initial/one-time Payments immediately after their schedules are written, while preserving safe missing-recipient and retry behavior.
- `src/lib/line/due-payments.ts`: choose eligible reminder slots, persist per-slot state, and reuse the established delivery workflow.
- Sheets record/migration modules: append the Payment log column and preserve all legacy column positions.
- `src/app/api/cron/generate/route.ts`: retain one daily entry point; call the extended generation and reminder workflow.

## Testing

- Fixed-slot calculation using Bangkok dates, including T-7, T-3, T-1, deadline, and T+1.
- Later installment created at least seven days out creates/sends T-7; one created late generates immediately and starts at next eligible slot; no backfill after T+1.
- One-time and initial installment schedules create and send their payment link and QR immediately; they never enter reminder scheduling.
- Each of five profiles validates, previews, and renders independently; all require amount, deadline, and payment URL.
- Settings save is atomic; legacy installment profile resolves as the deadline fallback until first save.
- Each slot sends text plus QR once; accepted slots do not duplicate across cron runs.
- Retry preserves text and retry key per slot; ambiguous acceptance enters review.
- Confirmed, recorded, or review-state payments stop remaining reminders.
- Missing LINE user affects only the current slot and does not prevent later eligible delivery.
- Existing accepted due-date messages never resend after migration.

Run affected Vitest suites during implementation, then `npm run lint`, `npm test`, and `npm run build`.

## Non-Goals

- Arbitrary reminder offsets, per-slot toggles, client-level overrides, or reminder rules for one-time/initial payments.
- Backfilled reminder messages.
- A separate reminder spreadsheet or external scheduling service.
- Altering payment amounts, due dates, URLs, or QR values through template editing.
