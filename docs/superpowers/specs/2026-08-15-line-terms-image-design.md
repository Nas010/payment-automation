# LINE Terms-and-Conditions Image Design

## Goal

Let the coach upload and replace one client-facing terms-and-conditions image from protected Settings. Send the active image with the first LINE payment request for every new payment plan, including packages assigned as extensions. Later installments receive the existing text and PromptPay QR only.

## Confirmed Requirements

- Reuse the already configured Google OAuth connection and Drive folder. No second Drive setup or storage vendor is required.
- Treat installment number `1` as the first payment of a plan. One-time plans and each newly assigned extension therefore qualify.
- Send one global T&S image, not a package-specific or client-specific image.
- Let an authenticated admin upload or replace the image from Settings.
- Accept JPEG and PNG only. Use a conservative 1 MiB application limit because the same asset serves as both the LINE original and preview image.
- A missing, invalid, or temporarily unreadable T&S image must not block a payment request. Send the existing text and QR and write a safe audit warning.
- Replacing the image affects future first attempts. An in-progress retry keeps the version selected for its original attempt.
- Keep old T&S versions available so frozen retries remain valid and the business retains a record of the version previously sent.

## Considered Approaches

### 1. Versioned Drive upload through Settings — selected

Store immutable image files in the existing configured Drive folder. Store small asset metadata in operational Settings and serve each image through a tokenized public application route.

This reuses current OAuth and storage infrastructure, supports replacement without deployment, and lets retries preserve exact image versions. It adds one upload card, one asset domain, one public read route, and one payment snapshot field.

### 2. External public image URL

Store a URL in Settings and let another host serve the image. This needs less application storage code but shifts availability, replacement, and access control outside the product. It does not provide the requested upload workflow.

### 3. Bundled static application image

Serve an image from `public/`. This is reliable and simple but every content change requires a code deployment. It does not provide the requested Settings replacement workflow.

## Architecture

### T&S asset domain

Add a focused LINE T&S asset module responsible for:

- validating file type from magic bytes rather than trusting the browser-provided MIME type;
- enforcing the byte limit;
- generating an immutable version ID and an unguessable public token;
- creating a Drive image file in the existing connected folder;
- parsing and validating stored asset metadata;
- resolving the active version and registered historical versions; and
- determining whether a payment is the first payment of its plan.

Keep Drive API calls in the existing storage boundary. Extend that boundary with narrowly scoped image-create and image-read functions instead of placing Google calls in UI, routes, or the LINE sender.

### Operational settings

Use two operational Settings keys:

- `line_terms_image_active_version` stores the active immutable version ID.
- `line_terms_image_versions` stores a versioned JSON registry containing version ID, public token, Drive file ID, MIME type, byte length, original filename, and upload timestamp.

The public token is random and independent from the Drive file ID. The route never accepts a caller-supplied Drive file ID. Historical registry entries remain available after replacement. T&S content is client-facing and intentionally retrievable through its unguessable URL; private slip files remain behind the existing authenticated admin route.

### Payment snapshot

Append `line_terms_image_token` to the Payment schema. Freeze it with `line_message` and `line_retry_key` before the first LINE request:

- registered token: send that exact T&S version;
- `NONE`: the payment was evaluated without an available T&S image;
- blank: no delivery attempt has frozen the decision yet.

Retries reuse the stored token or `NONE`; they never select a newer active version. Schema migration appends the field non-destructively and leaves existing rows blank.

## Settings Experience

Add a **LINE terms and conditions** card near the existing LINE message editor. It contains:

- current image preview and upload timestamp when configured;
- JPEG/PNG file picker;
- replace button when an image already exists;
- size/type guidance; and
- concise validation or Drive errors without OAuth details, file IDs, or remote response bodies.

Upload flow:

1. Require admin authentication.
2. Read the uploaded `File` and validate non-empty size, 1 MiB limit, and JPEG/PNG magic bytes.
3. Require the existing active Workspace connection.
4. Create a new immutable Drive file using a safe name such as `line-terms-<version>.<ext>` in the configured folder.
5. Append its metadata to the registry and switch the active version only after the Drive write succeeds.
6. Revalidate Settings and write a content-free audit event.

A failed upload preserves the previous active version. Replacement does not overwrite or delete the previous Drive file.

## Public Image Route

Add a public HTTPS route shaped like `/api/line/terms-image/<public-token>` because LINE servers must fetch image content without admin cookies.

The route:

1. matches the token against the registered T&S asset registry;
2. returns `404` for unknown or malformed tokens without touching Drive;
3. reads only the matched Drive file through the existing OAuth connection;
4. revalidates size and image magic bytes;
5. returns the stored image MIME type and immutable public cache headers; and
6. returns a generic `404` or `503` without exposing Google errors, settings content, or Drive IDs.

This route cannot retrieve arbitrary Drive content. Existing private payment slips remain accessible only through `/api/admin/slips/<paymentId>` after admin authentication.

## LINE Delivery Flow

For each deliverable payment:

1. Resolve payment type and installment position from the Payment snapshot, with the linked Schedule row as legacy fallback.
2. Qualify for T&S only when the resolved installment number is exactly `1`. This includes one-time plans, first installments, assigned package extensions, and manual plans created through the normal schedule builder.
3. Render and freeze existing LINE text as today.
4. If this is the first attempt for a qualifying payment, resolve and preflight the active T&S asset. Freeze its public token when usable; otherwise freeze `NONE` and append a safe `LINE_TERMS_IMAGE_SKIPPED` audit event.
5. Build one push request:
   - text message;
   - PromptPay QR image;
   - T&S image only when a registered token was frozen.
6. Persist existing LINE success/failure state and audit behavior.

Later installments always send the existing two-message push. Unknown legacy installment position also sends text and QR without T&S and records the safe skip reason rather than guessing.

## Error and Retry Behavior

- Missing active asset: freeze `NONE`, send text plus QR, audit `NOT_CONFIGURED`.
- Invalid stored metadata: freeze `NONE`, send text plus QR, audit `CONFIG_INVALID`.
- Drive preflight failure: freeze `NONE`, send text plus QR, audit `ASSET_UNAVAILABLE`.
- Public image route read failure after push acceptance: return a generic error and retain the frozen token for investigation; never expose Drive or OAuth details.
- LINE request retry: reuse existing retry key, text, and T&S token decision.
- Upload failure: preserve previous active asset and show a safe Settings error.
- Audit metadata contains payment ID, version ID where applicable, and stable reason code only. It never contains image bytes, public tokens, Drive IDs, OAuth details, or LINE message text.

T&S degradation must not replace existing delivery failure state. A successful text-and-QR fallback remains an accepted payment request.

## Testing

All tests use local mocks; none call Google Drive or LINE.

- Asset-domain tests: JPEG/PNG validation, spoofed MIME rejection, empty/oversized rejection, registry parsing, version activation, and first-plan-payment detection.
- Drive-boundary tests: correct folder, immutable filename, MIME type, byte stream, file ID handling, and sanitized failures.
- Settings action tests: auth, successful first upload, atomic replacement, failed replacement preservation, safe errors, audit metadata, and revalidation.
- Settings component tests: empty state, configured preview, validation text, and replace flow.
- Public route tests: registered token success, malformed/unknown token rejection before Drive access, revalidation, cache headers, and sanitized Drive failures.
- Payment schema tests: appended column order, migration, row mapping, and legacy blank values.
- LINE sender tests: first one-time payment, first installment, extension first installment, later installment, manual plan, legacy schedule fallback, missing asset fallback, invalid asset fallback, exact three-message order, and retry reuse after active-version replacement.
- Regression tests: current text/QR delivery, idempotency, LINE slip intake, private admin slip access, and configurable message profiles remain unchanged.

## Non-Goals

- Multiple T&S images in one plan.
- Package-specific, locale-specific, or client-specific T&S selection.
- Client acknowledgement, signature, or legal-consent tracking.
- Editing or generating image content inside the app.
- Deleting historical T&S versions automatically.
- Changing existing slip-storage privacy or LINE inbound-image handling.
