# LINE Message Test Harness

**Status:** Implemented
**Date:** 2026-08-15

## Goal

Let the coach connect one dedicated LINE test account and send realistic payment messages through the production LINE Messaging API without creating or changing real clients, schedules, payments, payment URLs, reminder delivery logs, or payment audit state.

The harness covers all supported payment-message paths:

- initial one-time payment;
- initial installment payment; and
- later-installment reminders at T-7, T-3, T-1, the due date, and T+1.

## Chosen Approach

Store a dedicated test-client profile in operational Settings and connect its LINE recipient through the existing LIFF application. This keeps test data out of the Clients and Payments sheets while exercising the same identity verification, template rendering, LINE push client, and configured channel credentials used in production.

Rejected alternatives:

- A hidden client row would reuse more persistence code but would pollute client, schedule, payment, and reporting data.
- A separate LINE channel would isolate delivery but duplicate credentials, LIFF configuration, and operational setup while testing a different integration from production.

## Test-Client Profile

Settings stores one versioned `line_message_test_profile` JSON value. It contains coach-entered client and plan values plus LINE connection state:

```ts
type LineMessageTestProfile = {
  version: 1;
  clientName: string;
  packageName: string;
  totalPriceThb: string;
  paymentType: "ONE_TIME" | "INSTALLMENTS";
  installmentCount: number;
  intervalMonths: number;
  firstDueDate: string;
  lineUserId: string;
  lineDisplayName: string;
  linePictureUrl: string;
  lineLinkStatus: "" | "LINK_ACTIVE" | "LINKED" | "REVIEW";
  lineLinkedAt: string;
  lineLinkError: string;
  lineLinkTokenHash: string;
  lineLinkTokenEncrypted: string;
  lineLinkTokenExpiresAt: string;
  updatedAt: string;
};
```

The coach may edit the client and plan fields at any time. Saving profile details preserves an existing valid LINE link. Payment-type-specific validation follows the production client form:

- one-time payments use one payment and a zero-month interval;
- installment plans require at least two installments and an interval of at least one month; and
- names, amounts, counts, intervals, and dates use the same parsers and bounds as production client creation.

This profile never appears in the Clients directory and has no client ID, schedule ID, or payment ID.

## LIFF Connection

Settings displays Connect, Reconnect, and Disconnect controls for the test recipient. Connect generates the same encrypted, expiring connection token used by client linking and opens the same LIFF page. The LIFF page submits its existing `idToken` and `connectionToken` payload to the existing `/api/line/connect` endpoint.

The server hashes the opaque connection token and resolves its scope:

1. Look for a matching, unexpired client or test-profile token without consuming it.
2. Reject missing, ambiguous, or expired tokens.
3. Verify the LINE ID token through the configured LINE Login channel exactly once.
4. Atomically consume the selected token and reserve the verified LINE user ID in its resolved scope.

Test claims use the existing global named-range namespaces for token and LINE-user reservations. Therefore:

- a connection token remains single-use;
- one LINE account cannot be linked to both a real client and the test profile;
- a real-client token cannot claim the test profile, or vice versa; and
- concurrent or replayed claims resolve to already-used, conflict, or expired states without overwriting the winner.

Reconnect first releases the old test-user reservation, then issues a new test-scoped token. Disconnect clears only test-profile LINE fields and releases its reservation. Neither action changes real client links.

## Admin Test Flow

Add a **LINE message testing** card under Settings. It contains:

1. Editable test-client fields.
2. Dedicated LINE connection status and controls.
3. Payment-type selector: One-time or Installments.
4. For installments, payment-stage selector: Initial or Later installment.
5. For later installments, installment-number selector from 2 through the configured count.
6. For later installments, reminder-slot selector: T-7, T-3, T-1, Due date, or T+1.
7. Rendered preview and Send test message button.

Impossible combinations never enter the service:

- one-time payments always use the Initial stage;
- installment #1 always uses the Initial stage; and
- reminder slots apply only to installment numbers greater than one.

Saving edited values updates the test profile. Sending validates the latest submitted values server-side, saves them, renders a preview, and sends only after the test recipient is linked.

## Scenario Construction

The harness builds an in-memory payment, client, and schedule view from the saved test profile. It does not persist these synthetic records.

- Initial one-time uses the configured one-time due-payment profile.
- Initial installment uses the configured installment due-payment profile.
- Later installment uses the configured profile for the selected reminder slot.
- Installment amount and any final remainder use the production schedule allocation logic.
- Later-installment due dates use the production month-interval calculation from the saved first due date and selected installment number.
- Reminder tests calculate a simulated Bangkok `today` equal to the selected slot's date relative to that real derived due date. They then pass the synthetic payment through the production reminder-eligibility function. This tests scheduling without changing the displayed due date or machine clock.
- Initial cases exercise the production immediate-send selection and do not enter reminder eligibility.

All supported placeholders receive values from the test-client profile and synthetic scenario, including client name, package, payment type, amount, total amount, due date, installment number, ordinal, count, and month name.

## Safe URL and QR

Test messages must never contain a real payment token, PromptPay payload, payable QR, or client payment URL.

The harness supplies a public, data-free test URL under the configured public base URL. It opens a page stating **Test message only — no payment is due**. A public sample QR image encodes only this harmless URL and is visibly marked `TEST`. LINE can fetch the image without admin authentication, but the route exposes no workbook, recipient, or payment data.

The test text uses this sample URL for `payment_url`. Delivery uses the same LINE image-message shape as production. Initial-payment tests also include the currently configured first-payment terms image when production would include it; later reminders do not.

## Delivery and State Isolation

The harness reuses:

- `renderLineDueMessageProfile` and existing placeholder resolution;
- current one-time, installment, and reminder configurations;
- current first-payment terms-image resolution;
- `sendLinePushMessage` with the configured production LINE channel access token; and
- existing request IDs, retry keys, safe LINE error codes, and response parsing.

Each button press represents one intentional test delivery. A unique retry key is frozen for that attempt and reused only for transport-level retry of that attempt. The service returns Accepted, Failed, or Review to the admin UI. Ambiguous acceptance shows Review and is not automatically resent.

Test delivery must not call payment or schedule writers. It must not mutate `line_message_*`, `line_reminder_delivery_log`, slip-expectation fields, payment status, schedule status, dashboard totals, or client next-due data.

## Audit and Errors

Every attempted test send appends one test-specific audit result:

- `LINE_MESSAGE_TEST_ACCEPTED`
- `LINE_MESSAGE_TEST_FAILED`
- `LINE_MESSAGE_TEST_REVIEW`

Audit metadata includes scenario type, payment type, stage, installment number when applicable, reminder slot when applicable, recipient ID suffix, request ID or safe error code, and outcome. It excludes message text, connection tokens, full LINE user IDs, URLs, QR data, and client profile values.

Validation or configuration failures occur before LINE delivery and return a field-safe admin error. Missing or disconnected test recipients block sending. Invalid saved templates block the affected scenario. LINE rejection and transport failures use existing sanitized codes. Audit failure after LINE acceptance does not turn the accepted delivery into a resend.

## Code Boundaries

- `src/lib/line/message-test-profile.ts`: profile schema, scenario validation, synthetic records, and placeholder inputs.
- `src/lib/line/message-test-delivery.ts`: production renderer/transport orchestration and isolated result model.
- `src/lib/line/connection.ts`: route a verified LIFF identity to client or test-profile claim services without weakening current client behavior.
- `src/lib/sheets/line-message-test-profile.ts`: Settings persistence plus atomic token/user reservation and release.
- `src/app/api/line/connect/route.ts`: retain existing request shape and verification, then resolve client/test token scope.
- `src/app/line/message-test/page.tsx`: public, data-free non-payment destination.
- `src/app/api/line/message-test-qr/route.ts`: public sample QR image containing only the test destination URL and a visible test marker.
- `src/app/admin/(protected)/settings/line-test-actions.ts`: admin profile, connect, disconnect, preview, and send actions.
- `src/components/admin/line-message-test-form.tsx`: Settings UI and conditional scenario controls.

Existing client-link, due-payment, and reminder services remain authoritative. Shared behavior should be extracted only where needed to prevent the harness from copying production rules.

## Testing

Unit and route tests cover:

- test-profile parsing and payment-type-specific validation;
- saving profile edits without erasing an existing link;
- same LIFF request and ID-token verification for both client and test tokens;
- atomic token consumption, replay handling, global LINE-user conflict, reconnect, and disconnect;
- one-time initial, installment initial, and later-installment scenario validation;
- production amount allocation, installment due-date calculation, and all five simulated reminder dates;
- exact template/profile selection for each scenario;
- current test-client values filling protected placeholders;
- first-payment terms-image inclusion and later-reminder exclusion;
- public sample URL and non-payable QR containing no private data;
- accepted, rejected, retryable, and ambiguous LINE outcomes;
- sanitized audit metadata; and
- assertions that no client, schedule, payment, slip, or reminder-delivery writer is called.

All unit tests mock LINE and Google boundaries. One manual acceptance test links a dedicated LINE account and sends each scenario through the deployed real endpoint. Final verification runs `npm run lint`, `npm test`, and `npm run build`.

## Non-Goals

- Sending tests to real clients.
- Creating test rows in Clients, Schedules, or Payments.
- Testing PromptPay payment acceptance or slip reconciliation.
- Creating a second LINE channel or LIFF application.
- Scheduling automatic test sends.
- Changing production templates from the test card.
- Persisting test delivery history outside the normal audit log.
