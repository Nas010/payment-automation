# Reminder Template Editor Reliability Design

## Goal

Make installment reminder templates previewable and saveable without forcing any specific placeholder into message text. Keep invalid placeholder references safe and make every failed action visible to the administrator.

## Validation

- A message may omit every system placeholder, including `amount`, `due_date`, and `payment_url`.
- A placeholder used in a message must still be known and resolvable.
- Custom placeholders remain profile-local. `payment_label` works in any reminder slot only when that slot defines it.
- Custom placeholder names, definitions, nesting, profile shape, and rendered LINE length retain current validation.
- Delivery continues attaching the payment QR independently of message contents.

## Editor

Each reminder slot uses the existing `LinePlaceholderEditor` pattern instead of a raw textarea. It exposes installment system placeholders and that slot's custom placeholders. Administrators can add, edit, rename, and remove profile-local custom placeholders using the same safety rules as the due-payment editor.

Preview and outcome state are slot-local. Server-action rejection text appears beside the affected slot. Buttons prevent overlapping requests. Edits made while a request is pending are not overwritten by stale responses.

## Actions and Data Flow

Preview submits only the selected slot and profile. The server validates and renders that profile independently, so an unfinished different slot cannot block preview.

Save submits the complete five-slot configuration. The server validates the full configuration before one atomic settings write and audit event. A successful response updates only state matching the submitted revision and shows confirmation. Restore defaults resets every slot and shows its preview.

## Error Handling

Expected validation failures return safe user-facing messages through rejected server actions and are caught by the client. No template content enters audit metadata. Unexpected failures use a generic fallback when no safe `Error.message` is available.

## Tests

- Domain tests prove profiles with zero placeholders validate and render.
- Domain tests retain rejection for unknown or unresolved placeholders.
- Action tests cover selected-slot preview, atomic save, invalid-save preservation, and auth.
- Component tests cover optional-placeholder messages, `payment_label` custom definition, visible validation errors, slot-local previews, pending-edit preservation, save confirmation, and restore defaults.
- Run lint, full Vitest suite, and production build.
