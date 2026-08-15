# LINE Profile Refresh Diagnostics

## Goal

Expose the outcome of automatic LINE profile refreshes in Vercel logs without writing private LINE identifiers, profile images, tokens, message content, or spreadsheet values.

## Design

The webhook's profile-refresh path will log one fixed event label for each result: `updated`, `skipped`, `profile_lookup_failed`, or `persistence_failed`. A successful update also records `image=present`, `image=missing`, or `image=rejected`. `missing` means LINE omitted the image; `rejected` means LINE supplied a value that failed the trusted-CDN validation. It never records the URL itself. The route will continue acknowledging a signed LINE event with HTTP 200, so diagnostics cannot cause webhook retries or affect payment/slip processing.

`updated` means the linked client row was saved. `skipped` means no matching linked client remained when the update ran. `profile_lookup_failed` covers unavailable channel credentials and LINE profile API failures. `persistence_failed` covers an exception while updating the client record. Logs contain labels only, never error messages or event/profile data.

## Testing

Webhook route tests verify one safe `updated` info log after a normal user message and one safe `profile_lookup_failed` warning after an upstream profile failure. Tests assert logged calls do not include LINE user ID, picture URL, access token, or message text.
