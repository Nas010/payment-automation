# LINE Client Avatar Design

## Goal

Give each linked client a recognizable face in the admin dashboard by storing the client's LINE profile-picture URL and showing it in both the client directory and client detail page.

## Scope

- Add `line_picture_url` to each client record.
- Capture the URL during one-tap LIFF linking from LINE's server-verified ID-token response.
- Refresh the URL when a linked user later generates a LINE follow or message webhook and the Messaging API profile request succeeds.
- Show a round avatar beside the client name in the client directory and client detail header.
- Show deterministic initials when no usable picture URL exists or the remote image fails to load.
- Clear the picture URL when the LINE account is disconnected.

Downloading, copying, or permanently caching LINE profile images is out of scope. Existing clients are not bulk-refreshed.

## Data Model and Migration

Append `line_picture_url` to `CLIENT_HEADERS` after the current 26 fields. Existing workbooks therefore gain column `AA`. The existing additive schema migration expands the Clients sheet and fills only the new blank header, preserving all existing cells.

Extend `ClientRecord` with a required string field. Empty string means no known LINE picture. Reads of existing rows remain compatible because the record mapper supplies an empty value for absent cells.

Update all client read and write ranges from `A:Z` to the range derived from the current header count, ending at `AA` for this schema. Include `line_picture_url` in optimistic LINE-state reservations and atomic LINE-link updates so identity fields cannot be split across competing link operations.

## Identity Data Flow

### One-tap LIFF link

1. Browser sends the LINE ID token and existing connection token to `/api/line/connect`.
2. Server submits the ID token to LINE's verification endpoint using the configured LINE Login channel ID.
3. Verification accepts `sub`, `name`, and optional `picture` only from LINE's successful server response. Browser-decoded claims remain untrusted.
4. Picture value is normalized to an allowed HTTPS LINE profile URL or an empty string.
5. Connection claim stores LINE user ID, display name, and picture URL in the same atomic client-row update.

LIFF must have the `profile` scope enabled. If LINE omits `picture`, linking still succeeds and the dashboard uses initials.

### Webhook refresh

When a linked LINE user sends a supported message or follow event, existing webhook handling requests that user's Messaging API profile. A successful response refreshes both display name and picture URL. A successful profile response without a picture clears the old URL, reflecting profile-picture removal. A failed profile request leaves existing name and picture unchanged and does not break webhook processing.

### Disconnect

Disconnect clears `line_user_id`, `line_display_name`, and `line_picture_url` together with existing LINE link state.

## Rendering

Create a small reusable admin avatar component accepting client name, LINE display name, and picture URL.

- Render a circular LINE-hosted image when URL is present.
- Use sanitized initials from LINE display name, falling back to client name.
- Fall back to initials after image-load failure.
- Keep client directory row density compact.
- Render a larger version beside the client name on the detail page.
- Configure Next.js to allow only LINE's profile image CDN host; do not allow arbitrary remote image hosts.

Avatar is display-only. Search, billing, payment, and messaging behavior remain unchanged.

## Error and Privacy Behavior

- Invalid or non-HTTPS picture values become empty strings; they never block linking.
- No avatar URL is written to audit metadata or logs.
- Remote images are loaded directly from LINE; application stores only URL in the private Clients workbook.
- Expired or inaccessible URLs degrade to initials without affecting page usability.

## Tests and Validation

Add failing tests before implementation, then cover:

- ID-token verification returns a valid optional picture URL and rejects/empties unsafe values.
- Connection claim persists user ID, display name, and picture together.
- Webhook profile refresh updates or clears picture only after a successful profile response.
- Disconnect clears picture.
- Clients schema appends `line_picture_url` without replacing existing headers or data.
- Sheet reads and writes include column `AA`.
- Client directory and detail page render image and initials fallback states.

Run focused Vitest tests during development, then `npm run lint`, full `npm test`, and `npm run build`. Validate both admin pages using the in-app browser. Production validation can confirm layout and fallback behavior, but acquiring a real avatar requires LINE Developers Console `profile` scope plus a real LINE mobile link or webhook interaction; report that separately and never claim it passed without evidence.
