# LINE Connection Due-Payment Delivery

**Status:** Approved design
**Date:** 2026-08-15

## Goal

Immediately send an existing unpaid initial payment request after a client successfully connects LINE through LIFF when that payment is due today or overdue.

## Assumption

The installment-reminder feature is already implemented and live. Client creation therefore creates the initial Payment row, stable public payment URL, and exact-payment QR before LINE connection. This feature does not create or rotate payment links.

## User Flow

1. Coach creates a client whose initial payment is due today.
2. The application creates the Payment row, public URL, and QR.
3. Client successfully connects LINE through LIFF.
4. The LINE connection is committed permanently.
5. The application immediately sends the existing payment message and existing QR to the newly linked LINE user.
6. A delivery failure never rolls back or weakens the successful LIFF connection.

## Trigger and Eligibility

Run post-connection delivery after both successful connection outcomes:

- `LINKED`: first successful claim;
- `ALREADY_LINKED`: idempotent retry of the same LIFF claim.

The idempotent outcome also triggers delivery so a lost HTTP response or interrupted first post-connection attempt can recover safely.

A Payment is eligible only when all conditions hold:

- `client_id` matches the connected client;
- status is `PENDING`;
- it is a one-time payment or installment number `1`;
- `due_date <= Bangkok today`;
- its existing public token, payment URL, amount, and QR inputs are valid;
- delivery is not already accepted or in review.

If multiple rows satisfy these rules, process them sequentially in creation order. Normal client creation should produce one eligible row, but deterministic multi-row handling prevents silent omission.

Future-due initial payments are not sent by this connection trigger. Their normal scheduled delivery remains unchanged.

## Architecture

Keep LINE identity linking independent from payment delivery.

### Connection Result

Extend the connection-domain result so successful outcomes include the canonical client ID:

```ts
type LineConnectionResult =
  | { status: "LINKED" | "ALREADY_LINKED"; clientId: string }
  | { status: "INVALID_OR_EXPIRED" | "CLIENT_INACTIVE" | "CONFLICT" };
```

The connection service remains responsible only for validating and atomically persisting the LINE link.

### Post-Connection Orchestrator

Add a focused service:

```ts
deliverDueInitialPaymentsAfterLineConnection({
  clientId,
  today,
}): Promise<PostConnectionDeliveryResult>
```

It reads current Payments, selects eligible IDs, then invokes the existing payment sender in immediate mode with those exact IDs. The existing sender owns recipient lookup, template rendering, frozen text, retry keys, QR attachment, LINE transport, persistence, and audit behavior.

The orchestrator never regenerates a Payment, public token, payment URL, or QR. Every attempt uses the canonical values created with the client payment.

### LIFF Route Ordering

The LIFF connect route performs operations in this order:

1. verify LINE identity;
2. atomically claim connection;
3. map connection result;
4. for `LINKED` or `ALREADY_LINKED`, attempt post-connection payment delivery;
5. return the original successful connection response regardless of payment-delivery outcome.

Payment delivery is awaited for deterministic persistence, but its failure is isolated in a nested boundary. It cannot change `success` to `temporary_failure`, delete LINE data, renew connection tokens, or roll back the claim.

## Retry and Idempotency

- Accepted payment messages never send twice.
- Ambiguous and retryable LINE failures reuse the existing frozen message and retry key.
- Repeated LIFF claims may invoke the orchestrator again; sender idempotency makes this safe.
- Normal cron remains fallback for eligible due initial payments left unsent after a connection-triggered failure.
- Payments in final, paid, or review states receive no connection-triggered send.

## Failure and Audit Behavior

- No eligible payment: return a successful no-op result.
- Payment selection failure: preserve connection, record a safe client-level failure audit when possible, then let cron retry.
- Template, recipient, or LINE transport failure: use existing payment delivery state and stable error codes.
- Audit metadata may contain client ID, payment ID, delivery outcome, and stable reason code only. Never include connection tokens, ID tokens, LINE access tokens, message text, payment URLs, QR data, or private notes.
- LIFF API response remains the existing connection response and never exposes payment existence or delivery status.

## Testing

### Connection Domain

- `LINKED` and `ALREADY_LINKED` include correct canonical client ID.
- Invalid, inactive, expired, and conflict results include no client ID.
- Existing atomic claim and conflict behavior remains unchanged.

### Eligibility Domain

- Select pending one-time and installment-1 rows due today.
- Include overdue rows defensively.
- Exclude future-due, later-installment, paid, accepted, review, invalid-link, and other-client rows.
- Sort multiple eligible rows by creation time and payment ID.

### LIFF Route

- Successful new connection triggers immediate delivery with connected client ID.
- Idempotent already-linked retry triggers safe delivery recovery.
- Delivery exception still returns successful connection response.
- Invalid/expired/conflict claims never invoke payment delivery.
- Responses contain no tokens, payment IDs, URLs, QR data, or delivery errors.

### Delivery Integration

- Send uses the Payment row's existing URL/public token and exact QR.
- Accepted delivery does not duplicate on repeated LIFF request.
- Retryable failure persists state and succeeds through normal retry path.
- Existing LIFF, reminder, terms-image, and due-payment tests remain green.

Run targeted Vitest suites, then `npm run lint`, `npm test`, and `npm run build`.

## Non-Goals

- Creating or rotating payment links during LINE connection.
- Sending later-installment reminders from the LIFF route.
- Sending future-due initial payments at connection time.
- Returning payment-delivery status to the LIFF client.
- Rolling back, disconnecting, or modifying a successful LINE link because payment delivery failed.

## Acceptance Criteria

- Creating a client with an initial payment due today, then completing LIFF connection, immediately sends that existing payment message and QR.
- Successful LIFF connection remains saved even when payment delivery fails.
- Same Payment URL and QR are reused; no duplicate Payment is created.
- Repeated connection requests and cron retries cannot duplicate an accepted message.
- No private payment or credential data appears in API responses or audit metadata.
