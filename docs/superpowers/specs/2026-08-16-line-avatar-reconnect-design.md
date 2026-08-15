# LINE Avatar Reconnect Refresh

## Goal

Refresh a linked client's trusted LINE display name and profile-picture URL when that same client opens an existing LINE connection link again.

## Design

`createLineConnectionService.claim` already accepts server-verified `displayName` and `pictureUrl`. For the same existing LINE user, it currently returns `ALREADY_LINKED` before persisting either value. Change this idempotent branch to update only `line_display_name`, `line_picture_url`, and `updated_at` through the existing optimistic `updateLineLinkClient` dependency, then return the same `ALREADY_LINKED` response.

Connection ownership, status, token fields, delivery behavior, and audit behavior remain unchanged. A failed optimistic update still leaves the account linked and returns `ALREADY_LINKED`; a later reconnect or webhook event can retry profile refresh.

## Testing

Add a focused service test using an already-linked client with an empty picture URL. It must prove an idempotent reconnect writes the trusted profile fields, retains the link state, and does not call the token-consuming `claimLineConnection` operation. Existing tests continue to cover the normal initial-link path.
