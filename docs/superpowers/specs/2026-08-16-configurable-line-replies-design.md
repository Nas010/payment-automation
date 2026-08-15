# Configurable LINE Replies Design

**Status:** Approved
**Date:** 2026-08-16

## Goal

Make every remaining hard-coded outbound LINE text editable in dashboard settings. Existing configurable welcome, due-payment, and installment-reminder messages remain unchanged.

## Scope

Add dashboard configuration for seven automatic replies:

### Payment slip replies

1. Payment recorded automatically.
2. Payment requires review because no single eligible payment could be selected.
3. Payment is flagged and needs trainer review.

### LINE connection replies

1. Account connected successfully.
2. Account already connected.
3. Connection code is invalid, expired, or belongs to an inactive client.
4. Connection conflicts with an existing LINE mapping.

Invalid and inactive connection outcomes intentionally share one configurable message because they currently expose the same safe response and must not reveal whether a client record exists.

## Dashboard Placement

Add an **Automatic replies** area to **Settings → Messages**. Keep it on the existing LINE message-settings page so coaches can find all outbound copy in one place.

The area contains two cards:

- **Payment slip replies** with three labeled multiline editors.
- **LINE connection replies** with four labeled multiline editors.

The cards belong to one form with one **Save automatic replies** action and one **Restore defaults** action. Saving or resetting always writes the complete seven-message configuration atomically. The UI shows safe success or failure feedback and keeps unsaved text when a save fails.

No per-message preview action is needed because these replies contain no placeholders; each editor already shows the exact text LINE will receive.

## Configuration Model

Store one JSON object in the workbook `Settings` sheet under `line_automatic_reply_config`:

```ts
type LineAutomaticReplyConfig = {
  version: 1;
  slip: {
    autoRecorded: string;
    review: string;
    flagged: string;
  };
  connection: {
    linked: string;
    alreadyLinked: string;
    invalidOrExpired: string;
    conflict: string;
  };
};
```

Each value must contain 1–5,000 characters after trimming. Parsing rejects missing keys, extra keys, unsupported versions, and non-string values. Dashboard writes persist trimmed values. No placeholders are supported in this version.

The documented defaults exactly match current hard-coded production copy, so installations without the setting keep existing behavior.

## Runtime Resolution

Create one focused LINE reply-config module that owns:

- Types and default messages.
- Strict parsing and validation.
- Resolution from operational settings.
- Selection of slip text by payment decision.
- Selection of connection text by link result.

Both LINE webhook paths load operational settings through the existing Sheets settings repository and resolve the config before replying.

- Slip processing receives the resolved config through its dependency boundary so unit tests remain isolated from Google Sheets.
- Connection processing resolves the config once per webhook request and uses it for every link event in that signed batch.
- Replay of a previously processed slip uses the currently saved reply config when retrying a failed LINE reply.

Missing config uses defaults. Malformed config also uses defaults at delivery time so a manual workbook edit cannot suppress safety-critical webhook replies. The settings page surfaces a generic invalid-configuration warning while showing defaults that can be saved or restored to repair the stored value.

## Server Actions and Audit

Add authenticated save and reset actions beside existing LINE message actions.

Save flow:

1. Require an admin session.
2. Parse the submitted complete JSON configuration.
3. Upsert `line_automatic_reply_config` once.
4. Append an audit event without storing message bodies.
5. Revalidate `/admin/settings`.
6. Return the normalized config.

Reset writes the documented default object and appends a separate reset audit event. Audit metadata contains only the setting key and config version.

## Error Handling

- Invalid submitted config performs no settings write or audit append.
- Settings-write failure returns safe UI feedback and preserves the draft.
- Missing or malformed stored config never blocks webhook acknowledgement or LINE reply delivery; runtime uses defaults.
- Existing LINE API failure, reply-state bookkeeping, and audit behavior remain unchanged.
- Message content is not added to logs, audit rows, or error messages.

## Testing

- Reply-config unit tests cover defaults, valid parsing, trimming, missing/extra keys, unsupported versions, empty text, overlong text, and safe stored-config fallback.
- Settings repository tests prove automatic-reply config validation and atomic persistence.
- Slip-processing tests prove all three decisions use configured replies, including failed-reply replay.
- Webhook route tests prove all four distinct connection replies use configured text while invalid and inactive outcomes share the safe configured response.
- Server-action tests cover authentication, save, reset, revalidation, audit metadata, and validation failure without writes.
- Settings-page tests cover placement and invalid stored-config recovery state.
- Component tests cover seven labeled editors, grouped cards, one atomic save, restore defaults, preserved drafts on failure, and safe feedback.
- Final verification runs `npm run lint`, `npm test`, and `npm run build`.

## Non-Goals

- Changing existing welcome, due-payment, QR-image, or installment-reminder configuration.
- Adding placeholders, rich messages, images, localization variants, or per-client overrides to automatic replies.
- Making internal dashboard status text or public payment-page copy configurable.
- Changing payment matching, slip evaluation, LINE linking, retry, or webhook security behavior.
