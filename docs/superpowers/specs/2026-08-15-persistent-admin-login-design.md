# Persistent Admin Login Design

**Date:** 2026-08-15

## Goal

Keep the verified installation owner signed in for 30 days and show Google's account picker whenever an admin Google authorization flow starts.

## Current Behavior

- `coaching_admin_session` is a signed, `HttpOnly` cookie with an absolute eight-hour expiry.
- The signed payload contains the owner's Google `sub`, normalized email, and expiry.
- Protected requests verify the signature, expiry, and current installation owner.
- Google authorization currently uses `prompt: "consent"`, which can continue with Google's default account without showing an account picker.
- The application has no 15-minute idle timeout. A logout sooner than eight hours means the cookie was missing or failed an existing validation check; extending the intended lifetime does not weaken those checks.

## Design

### Admin Session

Change the single session lifetime constant from eight hours to 30 days. Use the same value for both the signed payload expiry and cookie `maxAge`, so browser and server expiration remain aligned.

The session is an absolute 30-day session, not a sliding session. Activity does not extend it. A successful Google login creates a new 30-day session.

Preserve existing protections:

- `HttpOnly`
- `Secure` in production
- `SameSite=Lax`
- cookie path `/admin`
- HMAC signature using `ADMIN_SECRET`
- owner `sub` and email verification against the installation record
- manual Sign out deletes the cookie
- changing `ADMIN_SECRET` invalidates existing sessions

### Google Account Selection

Send `prompt: "consent select_account"` in every Google authorization request. `consent` preserves explicit offline-access consent and refresh-token behavior; `select_account` forces Google to display its account chooser instead of silently using a default account.

Existing owner validation remains authoritative. Selecting a Google account other than the permanent installation owner is rejected by the callback and does not create an admin session.

## Testing

Update focused tests before production code:

1. Assert cookie `maxAge` is 30 days.
2. Assert a newly signed session remains valid immediately before 30 days and is rejected at 30 days.
3. Assert Google authorization uses `prompt: "consent select_account"`.
4. Run the focused auth and OAuth route tests.
5. Run `npm run lint`, `npm test`, and `npm run build`.

## Documentation

Update README session wording from eight hours to 30 days. No environment or vendor configuration changes are required.

## Out of Scope

- Sliding session renewal
- Server-side session storage or revocation lists
- Changing the permanent installation owner
- Browser- or hostname-specific cookie diagnostics
