# Configurable LINE Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all seven remaining hard-coded LINE slip and connection replies editable from Settings → Messages without changing existing default delivery behavior.

**Architecture:** Add one strict versioned reply-config domain module and persist the complete configuration as one JSON operational setting. Dashboard actions and one grouped editor save or reset all seven messages atomically. Slip and connection webhook paths resolve the saved config at their existing dependency boundaries, using documented defaults when configuration is absent or malformed.

**Tech Stack:** Next.js 15 App Router, strict TypeScript, React 19, Vitest, Testing Library, Zod, Base UI shadcn components, Tailwind CSS v4, Google Sheets operational settings, LINE Messaging API.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-16-configurable-line-replies-design.md`.
- Configure exactly three slip replies and four distinct connection replies.
- Invalid and inactive connection results must share `invalidOrExpired`; never reveal client existence.
- Preserve current production copy as defaults.
- Persist one complete `line_automatic_reply_config` JSON object per save or reset.
- Every saved message is trimmed and contains 1–5,000 characters.
- Missing or malformed stored configuration falls back to defaults during LINE delivery.
- Do not add placeholders, rich messages, localization, or per-client overrides.
- Existing welcome, due-payment, QR-image, and reminder configuration stays unchanged.
- Message bodies must not enter logs, audit rows, error messages, or action metadata.
- Use `@/` imports, two-space indentation, semicolons, surrounding component patterns, and semantic Tailwind tokens.
- Unit tests must not call Google Sheets, LINE, or other live services.
- Follow test-driven development: verify each new test fails for the intended missing behavior before production edits.

## File Structure

- Create `src/lib/line/reply-config.ts`: own config type, defaults, strict parsing, stored-setting resolution, and outcome-to-message selection.
- Create `src/lib/line/reply-config.test.ts`: prove validation, fallback, and outcome mapping.
- Modify `src/lib/sheets/settings.ts`: validate and save the automatic-reply setting; expose a resolved runtime getter.
- Modify `src/lib/sheets/settings.test.ts`: prove validated atomic persistence and safe runtime resolution.
- Modify `src/app/admin/(protected)/settings/line-actions.ts`: add authenticated save/reset actions and content-free audits.
- Modify `src/app/admin/(protected)/settings/line-actions.test.ts`: prove auth, validation, persistence, reset, revalidation, and audit behavior.
- Create `src/components/admin/line-automatic-reply-form.tsx`: render grouped editors and own atomic draft/save/reset behavior.
- Create `src/components/admin/line-automatic-reply-form.test.tsx`: prove seven fields, grouping, save/reset, failure preservation, and feedback.
- Modify `src/app/admin/(protected)/settings/messages/page.tsx`: place automatic replies on existing message settings page.
- Modify `src/app/admin/(protected)/settings/messages/page.test.tsx`: prove one Settings read supplies resolved automatic-reply state and actions.
- Modify `src/lib/line/slip-payments.ts`: select configured slip replies through injected config.
- Modify `src/lib/line/slip-payments.test.ts`: prove all slip outcomes and reply replay use configured text.
- Modify `src/app/api/line/webhook/route.ts`: select configured connection replies once per signed link-event batch.
- Modify `src/app/api/line/webhook/route.test.ts`: prove all connection outcomes use saved text without disclosure or repeated settings reads.

---

### Task 1: Automatic Reply Configuration Domain

**Files:**
- Create: `src/lib/line/reply-config.test.ts`
- Create: `src/lib/line/reply-config.ts`

**Interfaces:**
- Produces: `LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY = "line_automatic_reply_config"`.
- Produces: `LineAutomaticReplyConfig` with `version`, `slip`, and `connection` records.
- Produces: `DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG` containing current production copy.
- Produces: `parseLineAutomaticReplyConfig(value: unknown): LineAutomaticReplyConfig`.
- Produces: `resolveLineAutomaticReplyConfig(settings): { kind: "VALID" | "INVALID"; config: LineAutomaticReplyConfig }`.
- Produces: `lineSlipReplyText(config, decision)` and `lineConnectionReplyText(config, result)`.
- Consumed by: settings persistence, dashboard actions/UI, slip processing, and webhook connection processing.

- [ ] **Step 1: Write failing default, parse, and resolution tests**

Create `src/lib/line/reply-config.test.ts` with behavioral cases:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG,
  LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY,
  parseLineAutomaticReplyConfig,
  resolveLineAutomaticReplyConfig,
} from "./reply-config";

describe("LINE automatic reply configuration", () => {
  it("keeps current production replies as documented defaults", () => {
    expect(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG).toEqual({
      version: 1,
      slip: {
        autoRecorded: "Payment slip received and recorded.",
        review: "Payment slip received. It will be reviewed.",
        flagged: "Payment slip received. Please contact your trainer so they can review it.",
      },
      connection: {
        linked: "✓ Connected\n\nYour coaching account is now linked. Future payment links can be sent here automatically.",
        alreadyLinked: "✓ Already connected\n\nThis LINE account is already linked to your coaching account.",
        invalidOrExpired: "I couldn't connect this account. The code is invalid or expired. Please ask your trainer for a new code.",
        conflict: "I couldn't connect this account automatically. Please contact your trainer so they can check the existing connection.",
      },
    });
  });

  it("trims every valid submitted message", () => {
    const input = structuredClone(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
    input.slip.autoRecorded = "  Recorded custom reply.  ";

    expect(parseLineAutomaticReplyConfig(JSON.stringify(input)).slip.autoRecorded)
      .toBe("Recorded custom reply.");
  });

  it("uses defaults when the setting is absent", () => {
    expect(resolveLineAutomaticReplyConfig([])).toEqual({
      kind: "VALID",
      config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG,
    });
  });

  it("surfaces invalid stored config while retaining safe defaults", () => {
    expect(resolveLineAutomaticReplyConfig([
      { key: LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY, value: "not JSON" },
    ])).toEqual({ kind: "INVALID", config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG });
  });
});
```

- [ ] **Step 2: Write failing strict-validation and outcome-selection tests**

Add cases that delete one key, add one key, use version `2`, submit whitespace, and submit 5,001 trimmed characters. Each must throw `LineAutomaticReplyConfigError`. Add outcome mapping assertions:

```ts
const config = structuredClone(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
config.slip = {
  autoRecorded: "recorded-custom",
  review: "review-custom",
  flagged: "flagged-custom",
};
config.connection = {
  linked: "linked-custom",
  alreadyLinked: "already-custom",
  invalidOrExpired: "invalid-custom",
  conflict: "conflict-custom",
};

expect(lineSlipReplyText(config, "AUTO_RECORDED")).toBe("recorded-custom");
expect(lineSlipReplyText(config, "MANUAL_CONFIRMED")).toBe("review-custom");
expect(lineSlipReplyText(config, "REVIEW")).toBe("review-custom");
expect(lineSlipReplyText(config, "FLAGGED")).toBe("flagged-custom");
expect(lineConnectionReplyText(config, "LINKED")).toBe("linked-custom");
expect(lineConnectionReplyText(config, "ALREADY_LINKED")).toBe("already-custom");
expect(lineConnectionReplyText(config, "INVALID_OR_EXPIRED")).toBe("invalid-custom");
expect(lineConnectionReplyText(config, "CLIENT_INACTIVE")).toBe("invalid-custom");
expect(lineConnectionReplyText(config, "CONFLICT")).toBe("conflict-custom");
```

- [ ] **Step 3: Run domain tests and verify RED**

Run:

```bash
npm test -- src/lib/line/reply-config.test.ts
```

Expected: FAIL because `reply-config.ts` does not exist.

- [ ] **Step 4: Implement strict versioned config and selectors**

Create `src/lib/line/reply-config.ts` using strict Zod objects:

```ts
import { z } from "zod";
import type { LinkResult } from "@/lib/line/linking";

export const LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY = "line_automatic_reply_config";

const messageSchema = z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(5000));
const schema = z.object({
  version: z.literal(1),
  slip: z.object({
    autoRecorded: messageSchema,
    review: messageSchema,
    flagged: messageSchema,
  }).strict(),
  connection: z.object({
    linked: messageSchema,
    alreadyLinked: messageSchema,
    invalidOrExpired: messageSchema,
    conflict: messageSchema,
  }).strict(),
}).strict();

export type LineAutomaticReplyConfig = z.infer<typeof schema>;
export type LineSlipReplyDecision = "AUTO_RECORDED" | "MANUAL_CONFIRMED" | "REVIEW" | "FLAGGED";
export type ResolvedLineAutomaticReplyConfig = {
  kind: "VALID" | "INVALID";
  config: LineAutomaticReplyConfig;
};

export class LineAutomaticReplyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LineAutomaticReplyConfigError";
  }
}
```

`parseLineAutomaticReplyConfig` accepts either a JSON string or parsed object, catches JSON/Zod errors, and throws `LineAutomaticReplyConfigError("LINE automatic reply configuration is invalid")` without including message bodies. `resolveLineAutomaticReplyConfig` finds the setting key, treats absence as valid defaults, and treats any parse failure as invalid defaults. Selector functions use exhaustive `switch` statements; both invalid and inactive connection results return `config.connection.invalidOrExpired`.

- [ ] **Step 5: Run domain tests and verify GREEN**

Run the Step 3 command. Expected: all `reply-config` tests PASS.

- [ ] **Step 6: Commit config domain**

```bash
git add src/lib/line/reply-config.ts src/lib/line/reply-config.test.ts
git commit -m "feat: define configurable LINE replies"
```

---

### Task 2: Settings Persistence and Authenticated Actions

**Files:**
- Modify: `src/lib/sheets/settings.test.ts`
- Modify: `src/lib/sheets/settings.ts`
- Modify: `src/app/admin/(protected)/settings/line-actions.test.ts`
- Modify: `src/app/admin/(protected)/settings/line-actions.ts`

**Interfaces:**
- Consumes: Task 1 config parser, defaults, setting key, and resolver.
- Produces: `saveLineAutomaticReplyConfig(config): Promise<void>`.
- Produces: `getLineAutomaticReplyConfig(): Promise<LineAutomaticReplyConfig>` with default fallback for absent/malformed stored data.
- Produces: `saveLineAutomaticReplyConfigAction(formData)` and `resetLineAutomaticReplyConfigAction()` returning `{ ok: true; config }`.
- Consumed by: dashboard component, settings page, slip processor, and connection webhook.

- [ ] **Step 1: Write failing settings repository tests**

In `src/lib/sheets/settings.test.ts`, import Task 1 symbols plus `getLineAutomaticReplyConfig` and `saveLineAutomaticReplyConfig`. Add:

```ts
it("stores one validated automatic reply object atomically", async () => {
  const config = structuredClone(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
  config.slip.review = "Custom review";

  await saveLineAutomaticReplyConfig(config);

  expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
    requestBody: expect.objectContaining({
      data: [expect.objectContaining({ values: [[
        LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY,
        JSON.stringify(config),
      ]] })],
    }),
  }));
});

it("rejects malformed automatic replies before a Sheets write", async () => {
  const invalid = structuredClone(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
  invalid.connection.conflict = "   ";

  await expect(upsertOperationalSetting(
    LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY,
    JSON.stringify(invalid),
  )).rejects.toThrow("LINE automatic reply configuration is invalid");
  expect(mocks.batchUpdate).not.toHaveBeenCalled();
});

it("loads saved automatic replies and safely falls back for malformed storage", async () => {
  const custom = structuredClone(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
  custom.connection.linked = "Connected custom";
  mocks.get.mockResolvedValueOnce({ data: { values: [["key", "value"], [
    LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY,
    JSON.stringify(custom),
  ]] } });
  await expect(getLineAutomaticReplyConfig()).resolves.toEqual(custom);

  mocks.get.mockResolvedValueOnce({ data: { values: [["key", "value"], [
    LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY,
    "invalid",
  ]] } });
  await expect(getLineAutomaticReplyConfig()).resolves.toEqual(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);

  mocks.get.mockRejectedValueOnce(new Error("Sheets unavailable"));
  await expect(getLineAutomaticReplyConfig()).resolves.toEqual(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
});
```

- [ ] **Step 2: Write failing server-action tests**

Extend the hoisted settings mocks with `saveLineAutomaticReplyConfig`. Import both new actions. Add a `LINE automatic reply actions` describe block proving:

```ts
it("requires admin access before parsing automatic replies", async () => {
  mocks.requireAdmin.mockRejectedValueOnce(new Error("Unauthorized"));

  await expect(saveLineAutomaticReplyConfigAction(new FormData())).rejects.toThrow("Unauthorized");
  expect(mocks.saveLineAutomaticReplyConfig).not.toHaveBeenCalled();
});

it("saves one complete config and audits no message body", async () => {
  const config = structuredClone(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
  config.slip.flagged = "Private custom flagged copy";
  const formData = new FormData();
  formData.set("config", JSON.stringify(config));

  await expect(saveLineAutomaticReplyConfigAction(formData)).resolves.toEqual({ ok: true, config });
  expect(mocks.saveLineAutomaticReplyConfig).toHaveBeenCalledWith(config);
  expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: "LINE_AUTOMATIC_REPLY_CONFIG_SAVED",
    metadata: JSON.stringify({ settingKey: LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY, version: 1 }),
  }));
  expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("Private custom flagged copy");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
});

it("rejects invalid submitted config before persistence or audit", async () => {
  const formData = new FormData();
  formData.set("config", JSON.stringify({ version: 1 }));

  await expect(saveLineAutomaticReplyConfigAction(formData)).rejects.toThrow();
  expect(mocks.saveLineAutomaticReplyConfig).not.toHaveBeenCalled();
  expect(mocks.appendAudit).not.toHaveBeenCalled();
});

it("restores and audits documented defaults", async () => {
  await expect(resetLineAutomaticReplyConfigAction()).resolves.toEqual({
    ok: true,
    config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG,
  });
  expect(mocks.saveLineAutomaticReplyConfig).toHaveBeenCalledWith(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
  expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: "LINE_AUTOMATIC_REPLY_CONFIG_RESET",
  }));
});
```

- [ ] **Step 3: Run repository/action tests and verify RED**

Run:

```bash
npm test -- src/lib/sheets/settings.test.ts 'src/app/admin/(protected)/settings/line-actions.test.ts'
```

Expected: FAIL because repository helpers and actions are missing.

- [ ] **Step 4: Implement repository validation and runtime getter**

In `upsertOperationalSettings`, add validation before any Settings read:

```ts
if (entry.key === LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY) {
  parseLineAutomaticReplyConfig(entry.value);
}
```

Add focused helpers:

```ts
export async function saveLineAutomaticReplyConfig(config: LineAutomaticReplyConfig): Promise<void> {
  const normalized = parseLineAutomaticReplyConfig(config);
  await upsertOperationalSetting(
    LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY,
    JSON.stringify(normalized),
  );
}

export async function getLineAutomaticReplyConfig(): Promise<LineAutomaticReplyConfig> {
  try {
    return resolveLineAutomaticReplyConfig(await listOperationalSettings()).config;
  } catch {
    return DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG;
  }
}
```

- [ ] **Step 5: Implement authenticated save/reset and content-free audit**

Add a private audit helper in `line-actions.ts` that records only setting key and version. Parse submitted `config` only after `requireAdmin()`:

```ts
export async function saveLineAutomaticReplyConfigAction(formData: FormData) {
  await requireAdmin();
  const config = parseLineAutomaticReplyConfig(String(formData.get("config") ?? ""));
  await saveLineAutomaticReplyConfig(config);
  await auditAutomaticReplyConfigChange("LINE_AUTOMATIC_REPLY_CONFIG_SAVED");
  revalidatePath("/admin/settings");
  return { ok: true as const, config };
}

export async function resetLineAutomaticReplyConfigAction() {
  await requireAdmin();
  await saveLineAutomaticReplyConfig(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
  await auditAutomaticReplyConfigChange("LINE_AUTOMATIC_REPLY_CONFIG_RESET");
  revalidatePath("/admin/settings");
  return { ok: true as const, config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG };
}
```

- [ ] **Step 6: Run repository/action tests and verify GREEN**

Run the Step 3 command. Expected: all selected tests PASS.

- [ ] **Step 7: Commit settings and actions**

```bash
git add src/lib/sheets/settings.ts src/lib/sheets/settings.test.ts 'src/app/admin/(protected)/settings/line-actions.ts' 'src/app/admin/(protected)/settings/line-actions.test.ts'
git commit -m "feat: persist LINE automatic replies"
```

---

### Task 3: Grouped Automatic Reply Settings UI

**Files:**
- Create: `src/components/admin/line-automatic-reply-form.test.tsx`
- Create: `src/components/admin/line-automatic-reply-form.tsx`
- Modify: `src/app/admin/(protected)/settings/messages/page.test.tsx`
- Modify: `src/app/admin/(protected)/settings/messages/page.tsx`

**Interfaces:**
- Consumes: `ResolvedLineAutomaticReplyConfig` and Task 2 save/reset actions.
- Produces: `LineAutomaticReplyForm` with seven controlled textareas grouped into two cards.
- Guarantees: one save submits complete JSON; reset replaces all seven fields; failed save leaves draft untouched.
- Preserves: page performs one `listOperationalSettings()` read for all message settings.

- [ ] **Step 1: Write failing component rendering test**

Create a jsdom test that renders `LineAutomaticReplyForm` with valid defaults and asserts:

```ts
expect(screen.getByText("Automatic replies")).toBeTruthy();
expect(screen.getByText("Payment slip replies")).toBeTruthy();
expect(screen.getByText("LINE connection replies")).toBeTruthy();
expect(screen.getByLabelText("Payment recorded automatically")).toHaveValue(
  DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.slip.autoRecorded,
);
expect(screen.getByLabelText("Payment needs review")).toBeTruthy();
expect(screen.getByLabelText("Payment flagged")).toBeTruthy();
expect(screen.getByLabelText("Connected successfully")).toBeTruthy();
expect(screen.getByLabelText("Already connected")).toBeTruthy();
expect(screen.getByLabelText("Invalid, expired, or inactive")).toBeTruthy();
expect(screen.getByLabelText("Connection conflict")).toBeTruthy();
expect(screen.getAllByRole("textbox")).toHaveLength(7);
```

Render `{ kind: "INVALID", config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG }` separately and assert visible text: `Saved automatic replies are invalid. Defaults are active until you save or restore them.`

- [ ] **Step 2: Write failing atomic save, reset, and failure tests**

Use `fireEvent` and `waitFor`:

```ts
fireEvent.change(screen.getByLabelText("Payment needs review"), {
  target: { value: "Custom review reply" },
});
fireEvent.change(screen.getByLabelText("Connection conflict"), {
  target: { value: "Custom conflict reply" },
});
fireEvent.click(screen.getByRole("button", { name: "Save automatic replies" }));

await waitFor(() => expect(saveAction).toHaveBeenCalledOnce());
const submitted = JSON.parse(String((saveAction.mock.calls[0]?.[0] as FormData).get("config")));
expect(submitted).toEqual({
  ...DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG,
  slip: { ...DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.slip, review: "Custom review reply" },
  connection: { ...DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.connection, conflict: "Custom conflict reply" },
});
```

Then prove reset response replaces every field and displays `Documented defaults restored.`. For failure, make `saveAction` reject `new Error("Could not save automatic replies.")`, edit one field, submit, assert the error appears and the edited field retains its draft.

- [ ] **Step 3: Write failing page integration test**

Extend page test mocks with `automaticReplyForm` and mock `resolveLineAutomaticReplyConfig`. After rendering, assert:

```ts
expect(mocks.listOperationalSettings).toHaveBeenCalledOnce();
expect(mocks.automaticReplyForm).toHaveBeenCalledWith(expect.objectContaining({
  resolved: { kind: "VALID", config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG },
  saveAction: expect.any(Function),
  resetAction: expect.any(Function),
}));
```

- [ ] **Step 4: Run UI tests and verify RED**

Run:

```bash
npm test -- src/components/admin/line-automatic-reply-form.test.tsx 'src/app/admin/(protected)/settings/messages/page.test.tsx'
```

Expected: FAIL because component and page integration are absent.

- [ ] **Step 5: Implement grouped controlled form**

Create a client component using project `Card`, `Field`, `Textarea`, and `Button` primitives. Keep one `draft` state object and update nested fields immutably. Use one enclosing form and create `FormData` explicitly:

```ts
const save = () => {
  const formData = new FormData();
  formData.set("config", JSON.stringify(draft));
  setOutcome("");
  startTransition(async () => {
    try {
      const result = await saveAction(formData);
      setDraft(result.config);
      setOutcome("Automatic replies saved.");
    } catch (error) {
      setOutcome(error instanceof Error && error.message
        ? error.message
        : "Could not save automatic replies.");
    }
  });
};
```

Render a small section heading/description followed by two cards. Put three `Field` controls in the slip card and four in the connection card. Each textarea is `required`, has `maxLength={5000}`, and uses 4–6 rows. Put one action row after both cards with **Save automatic replies** and **Restore defaults**. Disable all actions while a request is pending. Use one `aria-live="polite"` outcome.

Restore calls `resetAction()`, then replaces `draft` only on success. It never clears draft before the server response.

- [ ] **Step 6: Place component on Settings → Messages**

Resolve from the page's already-loaded settings:

```tsx
const automaticReplies = resolveLineAutomaticReplyConfig(settings);

<LineAutomaticReplyForm
  resolved={automaticReplies}
  saveAction={saveLineAutomaticReplyConfigAction}
  resetAction={resetLineAutomaticReplyConfigAction}
/>
```

Place it after the welcome-message card and before due-payment/reminder editors, making automatic bot replies easy to find without displacing existing payment message controls.

- [ ] **Step 7: Run UI tests and verify GREEN**

Run the Step 4 command. Expected: all selected tests PASS.

- [ ] **Step 8: Commit dashboard UI**

```bash
git add src/components/admin/line-automatic-reply-form.tsx src/components/admin/line-automatic-reply-form.test.tsx 'src/app/admin/(protected)/settings/messages/page.tsx' 'src/app/admin/(protected)/settings/messages/page.test.tsx'
git commit -m "feat: edit automatic LINE replies"
```

---

### Task 4: Configured Payment Slip Replies

**Files:**
- Modify: `src/lib/line/slip-payments.test.ts`
- Modify: `src/lib/line/slip-payments.ts`

**Interfaces:**
- Consumes: `getLineAutomaticReplyConfig`, `LineAutomaticReplyConfig`, and `lineSlipReplyText`.
- Extends: `LineSlipDependencies` with `automaticReplyConfig: LineAutomaticReplyConfig`.
- Preserves: `processLineSlipEvent(event, injected?): Promise<LineSlipResult>` and all reply-state/retry behavior.
- Guarantees: automatic, review, flagged, and failed-reply replay paths use current configured text.

- [ ] **Step 1: Add configured reply fixture and failing automatic-result test**

In the test dependency factory, add:

```ts
const automaticReplyConfig = structuredClone(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);

return {
  automaticReplyConfig,
  // existing dependencies
};
```

Set `automaticReplyConfig.slip.autoRecorded = "Custom recorded reply"`, process a normal slip, and assert `replyLineMessage` receives that text.

- [ ] **Step 2: Convert review and flagged expectations to configured copy**

In the existing ambiguous-review test, inject `slip.review = "Custom review reply"`. In the flagged-payment test, inject `slip.flagged = "Custom flagged reply"`. Assert the exact respective text reaches `replyLineMessage`.

- [ ] **Step 3: Write failing replay test for current configured copy**

Use a terminal `AUTO_RECORDED` payment with `line_reply_status: "FAILED"`, set `slip.autoRecorded = "Current retry reply"`, process the same message ID, and assert the retry sends `Current retry reply` without downloading image content.

- [ ] **Step 4: Run slip tests and verify RED**

Run:

```bash
npm test -- src/lib/line/slip-payments.test.ts
```

Expected: FAIL because slip processing still calls the hard-coded `replyText` function and the dependency type lacks config.

- [ ] **Step 5: Inject runtime config and select reply by decision**

Import the config type and selector. In `defaultDependencies`, load configuration beside runtime config:

```ts
const [config, automaticReplyConfig] = await Promise.all([
  runtimeConfig(),
  getLineAutomaticReplyConfig(),
]);

return {
  // existing dependencies
  automaticReplyConfig,
};
```

Delete the hard-coded `replyText` function. In `replyAfterResult`, send:

```ts
text: lineSlipReplyText(dependencies.automaticReplyConfig, decision),
```

Do not change SENDING/SENT/FAILED writes, audit reasons, terminal-effect reconciliation, or retry eligibility.

- [ ] **Step 6: Run slip tests and verify GREEN**

Run the Step 4 command. Expected: all slip tests PASS.

- [ ] **Step 7: Commit configured slip replies**

```bash
git add src/lib/line/slip-payments.ts src/lib/line/slip-payments.test.ts
git commit -m "feat: configure LINE slip replies"
```

---

### Task 5: Configured LINE Connection Replies

**Files:**
- Modify: `src/app/api/line/webhook/route.test.ts`
- Modify: `src/app/api/line/webhook/route.ts`

**Interfaces:**
- Consumes: `getLineAutomaticReplyConfig`, defaults, and `lineConnectionReplyText`.
- Preserves: signature verification, event isolation, profile enrichment, link-state privacy, and webhook acknowledgement.
- Guarantees: at most one automatic-reply Settings read for a signed batch containing link commands; zero reads for empty, image-only, follow-only, or ordinary-text batches.

- [ ] **Step 1: Add settings mock and configured copy fixture**

Extend hoisted route mocks with `getLineAutomaticReplyConfig`. Mock `@/lib/sheets/settings` and default it to a cloned config whose four connection messages are `linked-custom`, `already-custom`, `invalid-custom`, and `conflict-custom`.

- [ ] **Step 2: Make existing connection-result tests expect configured copy**

Update the multi-link test to expect `linked-custom` and `invalid-custom`. Update the existing mandated/privacy test to expect `already-custom`, `invalid-custom`, and `conflict-custom`. Add:

```ts
expect(mocks.getLineAutomaticReplyConfig).toHaveBeenCalledTimes(1);
```

for each multi-event link batch.

- [ ] **Step 3: Write failing inactive privacy and non-link read tests**

Prove inactive and invalid/expired outcomes both send `invalid-custom`. Extend empty/image/follow/ordinary-text tests with:

```ts
expect(mocks.getLineAutomaticReplyConfig).not.toHaveBeenCalled();
```

- [ ] **Step 4: Write failing settings-read fallback test**

Make `getLineAutomaticReplyConfig` reject once with `new Error("Sheets unavailable")`, send a valid signed link event, and assert the current documented default connection text is sent while response status remains 200.

- [ ] **Step 5: Run webhook tests and verify RED**

Run:

```bash
npm test -- src/app/api/line/webhook/route.test.ts
```

Expected: FAIL because route still uses module-level `REPLY_TEXT` constants and never reads reply config.

- [ ] **Step 6: Resolve once per link-event batch and use selector**

Delete `REPLY_TEXT`. After signature and JSON validation, determine whether the batch contains a valid direct link command. Resolve only when needed and catch Settings-read failures:

```ts
let automaticReplyConfig = DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG;
if (events.some((value) => directLinkEvent(value) !== null)) {
  try {
    automaticReplyConfig = await getLineAutomaticReplyConfig();
  } catch {
    automaticReplyConfig = DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG;
  }
}
```

Pass config into `processEvent(event, automaticReplyConfig)`. Send:

```ts
text: lineConnectionReplyText(automaticReplyConfig, result),
```

Keep `CLIENT_INACTIVE` mapped to `invalidOrExpired` through Task 1 selector. Do not include config or message bodies in failure audits.

- [ ] **Step 7: Run webhook tests and verify GREEN**

Run the Step 5 command. Expected: all webhook tests PASS.

- [ ] **Step 8: Commit configured connection replies**

```bash
git add src/app/api/line/webhook/route.ts src/app/api/line/webhook/route.test.ts
git commit -m "feat: configure LINE connection replies"
```

---

### Task 6: Integrated Verification and Requirements Check

**Files:**
- Review: all files changed in Tasks 1–5
- Review: `docs/superpowers/specs/2026-08-16-configurable-line-replies-design.md`

**Interfaces:**
- Verifies: domain → Sheets → admin actions → settings UI → slip webhook → connection webhook.
- Produces: evidence that all seven messages are configurable and existing project checks remain green.

- [ ] **Step 1: Run all focused automatic-reply tests together**

```bash
npm test -- src/lib/line/reply-config.test.ts src/lib/sheets/settings.test.ts 'src/app/admin/(protected)/settings/line-actions.test.ts' src/components/admin/line-automatic-reply-form.test.tsx 'src/app/admin/(protected)/settings/messages/page.test.tsx' src/lib/line/slip-payments.test.ts src/app/api/line/webhook/route.test.ts
```

Expected: every selected suite PASS with no unhandled errors or warnings.

- [ ] **Step 2: Inspect changed code and default-copy inventory**

Run:

```bash
git diff --check
rg -n "Payment slip received and recorded|Payment slip received\. It will be reviewed|I couldn't connect this account|✓ Connected|✓ Already connected" src/lib/line src/app/api/line
```

Expected: diff check exits 0. Default outbound copy appears only in `reply-config.ts` and its tests, not in slip or webhook production files.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: exit 0 with no ESLint errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: exit 0 with zero failed tests.

- [ ] **Step 5: Run production build**

```bash
npm run build
```

Expected: exit 0 with successful Next.js production compilation and type checking.

- [ ] **Step 6: Review every spec requirement**

Confirm from code and tests:

- Exactly seven textareas appear under Settings → Messages.
- Three slip and four connection outcomes use saved config.
- Invalid and inactive link states share safe copy.
- Save/reset are atomic, authenticated, audited, and content-free.
- Missing/malformed config and Settings-read failure use defaults.
- Existing welcome, due, reminder, security, matching, retry, and audit behavior remains intact.

- [ ] **Step 7: Commit any verification-only corrections**

If verification required code corrections, stage only those reviewed files and create one scoped conventional commit. If no corrections were required, create no empty commit.
