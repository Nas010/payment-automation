# Configurable LINE Due-Message Placeholders

**Status:** Approved design
**Date:** 2026-08-15

## Goal

Let the coach compose separate LINE due-payment messages for one-time and installment payments without typing placeholder syntax. The editor exposes protected client-facing payment data as insert buttons and lets the coach create reusable custom placeholders from that protected data.

## Product Decisions

- Provide independent **One-time payment** and **Installments** message profiles.
- Keep canonical payment values protected. The coach may insert them but cannot rename, delete, or override them.
- Let the coach add, rename, edit, and remove custom placeholders within either profile.
- Custom placeholder definitions may reference system placeholders only. They may not reference other custom placeholders.
- Main messages may reference system and custom placeholders.
- `amount`, `due_date`, and `payment_url` remain required, either directly or through a custom placeholder used by the main message.
- Preserve final rendered LINE text before the first delivery attempt. Retries reuse the frozen text even if Settings later change.
- Expose client-facing data only. Internal IDs, public tokens, delivery state, audit data, and review state are not placeholders.

## Settings Experience

The existing **LINE due-payment message** card becomes a profile editor with two tabs:

1. **One-time payment**
2. **Installments**

Each profile owns:

- one main message template;
- zero to twenty custom placeholder definitions;
- one preview generated with safe sample values;
- one atomic save operation for its message and custom definitions.

### Placeholder Buttons

System placeholders appear as buttons above any editor that may use them. Custom placeholders also appear above the main message editor.

Clicking a button inserts the literal `{{placeholder_name}}` at the textarea's current selection. The editor restores focus and places the caret immediately after the inserted token. Selection replacement, insertion at the start or end, and repeated insertion must work.

The custom-placeholder editor shows system buttons only. The main-message editor shows both system and custom buttons. This makes the allowed dependency direction visible in the UI.

### Custom Placeholder Management

Each custom placeholder has:

- a stable machine name, such as `payment_label` or `greeting`;
- editable template content;
- a remove action.

Names must match `[a-z][a-z0-9_]{0,39}`. Names are unique within the profile and may not shadow a system placeholder.

Removing or renaming a custom placeholder still referenced by the main message is blocked with a specific validation error. Custom content must not be empty. A profile may contain at most twenty custom placeholders, and each definition may contain at most 1,000 characters.

Example installment definition:

```text
greeting = Hi {{client_name}} 👋
payment_label = {{installment_ordinal_word}} payment out of {{installment_count_word}} for {{package_name}}
```

Example installment message:

```text
{{greeting}}

Your {{payment_label}} is due.
Amount: {{amount}}
Due date: {{due_date}}
{{payment_url}}
```

## Protected System Placeholders

Both profiles expose:

| Placeholder | Rendered value |
| --- | --- |
| `client_name` | Current client name |
| `package_name` | Package or manually assigned payment-plan label |
| `payment_type` | `One-time payment` or `Installments` |
| `amount` | Exact amount due, formatted as THB |
| `total_amount` | Complete plan amount, formatted as THB |
| `due_date` | Canonical due date |
| `due_month_name` | English due-month name, retained for useful wording and legacy compatibility |
| `payment_url` | Canonical public payment URL |

The installment profile additionally exposes:

| Placeholder | Example for installment 2 of 3 |
| --- | --- |
| `installment_number` | `2` |
| `installment_ordinal` | `2nd` |
| `installment_number_word` | `two` |
| `installment_ordinal_word` | `second` |
| `installment_count` | `3` |
| `installment_count_word` | `three` |

English number and ordinal-word conversion must support every positive safe installment count accepted by the plan domain. Invalid schedule numbers fail resolution rather than producing misleading text.

Installment placeholders are not offered or accepted in the one-time profile. The coach controls one-time wording independently instead of receiving `1st payment out of 1` accidentally.

## Configuration Model

Store each profile as one versioned JSON value in the operational Settings key/value table:

- `line_due_message_profile_one_time`
- `line_due_message_profile_installments`

Conceptual type:

```ts
type LineDueMessageProfile = {
  version: 1;
  message: string;
  customPlaceholders: Array<{
    name: string;
    template: string;
  }>;
};
```

One server action validates and writes one complete profile. A failed validation or Sheets write leaves the prior profile intact. Audit entries record the profile key and action but never copy message or custom-placeholder content into audit metadata.

## Payment Data Snapshot

Append these client-facing plan fields to new Payment rows:

- `package_name`
- `payment_type`
- `installment_number`
- `installment_count`
- `total_price_thb`

Payment generation copies package, payment type, and installment position from the matched schedule row. It calculates the plan total by summing the canonical schedule group created together for the same client and plan. Schedule rows created by one assignment share `client_id`, `package_name`, `payment_type`, `installment_count`, and `created_at`; this group is the compatibility identity until a dedicated plan ID exists.

The sender uses current Clients data for the LINE recipient and `client_name`. It uses the Payment snapshot for plan terms, plus the Payment row's existing amount, due date, and URL. Later client or package edits therefore do not rewrite the meaning of an already generated payment.

The Payments schema migration appends headers without moving or rewriting existing columns. Workbook setup and validation use the expanded canonical header list.

## Legacy Payment Fallback

Existing Payment rows will not contain the new snapshot fields. The batched sender snapshot therefore reads Payments, Clients, and Installment Schedule in one Sheets `batchGet` request.

For a legacy pending payment, resolution finds its schedule by `payment_id`, then uses the schedule's package, payment type, and installment position. It reconstructs total plan price by summing the schedule group described above. If required data cannot be resolved and the selected template references it, rendering fails safely and no LINE request is made.

New rows always prefer their Payment snapshot. The schedule join exists only as compatibility fallback.

## Rendering and Validation

Rendering is deterministic and has no network or AI dependency:

1. Select profile from the payment's canonical `payment_type`.
2. Build the protected system-value map.
3. Validate each custom definition against the system-placeholder catalog for that profile.
4. Render every custom definition from system values.
5. Merge rendered custom values with system values.
6. Validate the main message against the merged placeholder catalog.
7. Render the main message.
8. Enforce LINE's 1–5,000 character limit after substitution.
9. Persist the rendered message and retry key before sending.

Unknown, malformed, empty, or profile-incompatible placeholders are errors. Duplicate custom names and reserved-name shadowing are errors.

Required-placeholder validation is transitive. The validator builds the set of system placeholders referenced directly by the main message and by every custom placeholder the main message uses. That reachable set must contain `amount`, `due_date`, and `payment_url`. Unused custom definitions do not satisfy the rule.

Because custom definitions cannot reference custom definitions, rendering cannot recurse and cannot form dependency cycles.

## Preview

Preview remains a protected server action and uses safe sample data. The installment preview uses a second payment in a three-payment package so every numeric and word placeholder is visible. The one-time preview uses a one-time package and rejects installment-only placeholders.

Preview resolves custom placeholders exactly like delivery. It displays the final message and field-specific validation errors without persisting changes.

## Backward Compatibility

For each payment type, the existing `line_due_message_template` setting remains a read-only legacy fallback until that payment type's new profile is saved.

When a new profile key is absent:

- use the legacy main message for that payment type;
- expose a default custom `payment_label` whose definition is `{{due_month_name}} Coaching`, preserving the old rendered behavior;
- do not mutate Settings during a read or send operation.

The first successful save of a profile writes its new JSON key. The other profile continues using legacy fallback until independently saved. Existing frozen messages and retry keys are never re-rendered.

Fresh workbooks receive explicit profile defaults and do not require the legacy key. Both default messages keep the existing greeting, amount, due date, PromptPay instructions, slip-return instructions, and payment URL. Their editable `payment_label` definitions differ:

- One-time: `{{package_name}} payment`
- Installments: `{{installment_ordinal}} payment out of {{installment_count}} for {{package_name}}`

Both default main messages use `Your {{payment_label}} is due.` so the custom definition owns the complete label grammar.

## Failure Behavior

- Invalid edits remain in the browser and are not persisted. The UI identifies the profile, custom placeholder, and reason.
- A Settings write failure preserves the last valid profile and reports a non-secret admin error.
- A corrupt stored profile never falls back silently to a different payment-type profile. Delivery sets `line_message_status` to `FAILED_RETRYABLE` and `line_message_error` to `TEMPLATE_INVALID`, sends nothing, and may retry after Settings are corrected.
- Missing referenced snapshot data sets `line_message_status` to `FAILED_RETRYABLE` and `line_message_error` to `TEMPLATE_DATA_MISSING`, then sends nothing.
- Audit metadata contains setting keys and stable error codes, not client message content.
- Delivery retry and ambiguous-acceptance handling remain unchanged.

## Testing

### Template Domain

- Validate profile-specific system catalogs.
- Render direct and custom-placeholder references.
- Prove custom-to-custom references are rejected.
- Prove required amount, due date, and URL references work directly and transitively.
- Reject required references reachable only through unused custom definitions.
- Reject malformed, unknown, duplicate, reserved, empty, oversized, and installment-in-one-time definitions.
- Cover numeric, numeric-ordinal, number-word, and ordinal-word conversion, including 11th, 12th, 13th, and larger accepted counts.
- Enforce final 5,000-character limit.

### Admin UI and Actions

- Insert buttons at start, middle, end, and over selected text; restore caret and focus.
- Show system-only buttons in custom editors and system-plus-custom buttons in main editor.
- Add, rename, and remove custom placeholders.
- Block removal or rename while referenced.
- Keep profile edits independent across tabs.
- Preview without persistence.
- Save one complete validated profile and audit only its key.
- Preserve old profile after validation or Sheets failure.

### Payment and Delivery

- Append new Payment snapshot columns without shifting legacy columns.
- Snapshot package, payment type, installment position, and exact plan total during generation.
- Resolve legacy rows from schedule fallback in the batched snapshot.
- Select correct profile for one-time and installment payments.
- Render current client name with stable payment-plan snapshot values.
- Persist text before LINE delivery and reuse it for retries after profile changes.
- Send nothing and record stable error codes for invalid config or missing referenced data.

Run targeted Vitest suites during implementation, then `npm run lint`, `npm test`, and `npm run build` before completion.

## Non-Goals

- Exposing internal IDs, tokens, workflow status, review data, audit data, or private notes.
- Conditional syntax inside one profile.
- Custom placeholders referencing other custom placeholders.
- Editing canonical amount, due date, URL, client, package, or installment data from the message editor.
- Re-rendering messages already frozen for a delivery attempt.

## Acceptance Criteria

- Coach can independently configure one-time and installment LINE due messages.
- Coach can insert every allowed placeholder at the active caret by clicking a button.
- Coach can add, edit, rename, and remove up to twenty custom placeholders per payment type.
- Custom placeholders can combine protected client/payment data but cannot depend on other custom placeholders.
- Installment messages can choose numeric or English-word payment position and count.
- Amount, due date, and payment URL cannot be omitted, including through indirect custom-placeholder usage.
- Existing saved templates and pending payments continue working without workbook reset.
- Invalid configuration cannot send a partial or misleading LINE message.
- Retry idempotency and frozen-message behavior remain intact.
