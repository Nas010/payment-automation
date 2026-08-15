# LINE Terms-and-Conditions Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload one versioned T&S image through protected Settings and include its frozen version in the first LINE payment request for every new plan, including extensions.

**Architecture:** Add a pure T&S asset domain backed by two operational Settings keys and immutable files in the already configured Google Drive folder. Serve registered assets through an unguessable public app route, snapshot the chosen asset token on each first-plan Payment row, and append a third LINE image message without changing later-installment delivery. Missing, invalid, or unreadable T&S assets degrade to the existing text-plus-QR push.

**Tech Stack:** Next.js 15 App Router/server actions, React 19, strict TypeScript, Google Drive API through `googleapis`, Google Sheets operational settings, LINE Messaging API adapter, Vitest, Testing Library.

## Global Constraints

- Follow approved spec: `docs/superpowers/specs/2026-08-15-line-terms-image-design.md`.
- Reuse the active Google OAuth connection and its configured Drive folder; add no storage vendor, credential, deployment variable, or second Drive setup.
- One global JPEG or PNG image only; maximum validated payload is exactly `1 * 1024 * 1024` bytes.
- Treat resolved installment number `"1"` as first payment for one-time plans, installment plans, package extensions, and manual plans.
- Missing, corrupt, or temporarily unreadable T&S data must never prevent existing text and PromptPay QR delivery.
- Freeze a registered public token or literal `NONE` with the existing LINE retry state before the first request; retries never select a newer asset.
- Preserve every registered historical version and Drive file. Do not add automatic deletion.
- Public route accepts only registered random tokens; it must never accept or derive arbitrary Drive file IDs.
- Never expose image bytes, public tokens, Drive IDs, OAuth details, LINE message text, or Google response bodies in audit metadata or error responses.
- Unit tests use local mocks only. Do not call Google Drive, Google Sheets, LINE, or other live vendors.
- Use strict TypeScript, `@/` imports, two-space indentation, semicolons, and colocated behavioral tests.
- Preserve unrelated dirty-worktree edits. At execution start, record `git status --short`. A task commit is allowed only when every task path was clean at baseline or newly created by that task; otherwise skip that task commit and leave its changes unstaged. Never stash, reset, restore, or overwrite pre-existing edits.

## File Structure

- Create `src/lib/line/terms-image.ts` — pure constants, types, byte validation, settings parsing, registry operations, token/path validation, and first-plan detection.
- Create `src/lib/line/terms-image.test.ts` — pure asset and eligibility coverage.
- Modify `src/lib/sheets/settings.ts` — load and atomically activate versioned T&S metadata.
- Modify `src/lib/sheets/settings.test.ts` — settings persistence and corrupt-registry behavior.
- Modify `src/lib/storage/drive-client.ts` — narrowly scoped immutable T&S file creation and byte reads.
- Modify `src/lib/storage/drive-client.test.ts` — Drive request shape and sanitized failures.
- Create `src/lib/line/terms-image-upload.ts` — orchestrate validated upload into the configured Drive folder, then activate metadata.
- Create `src/lib/line/terms-image-upload.test.ts` — upload ordering, replacement, and failure preservation.
- Create `src/app/admin/(protected)/settings/terms-image-actions.ts` — authenticated upload server action and safe audit.
- Create `src/app/admin/(protected)/settings/terms-image-actions.test.ts` — action auth, safe result, audit, and revalidation.
- Create `src/components/admin/line-terms-image-form.tsx` — current preview plus upload/replace interaction.
- Create `src/components/admin/line-terms-image-form.test.tsx` — empty/configured states and file submission.
- Modify `src/app/admin/(protected)/settings/page.tsx` — load active T&S summary and render card.
- Modify `next.config.ts` — allow 2 MiB Server Action bodies so a 1 MiB file plus multipart framing reaches app validation.
- Create `src/app/api/line/terms-image/[publicToken]/route.ts` — public, registry-restricted Drive image proxy.
- Create `src/app/api/line/terms-image/[publicToken]/route.test.ts` — token rejection, content, caching, and failure sanitization.
- Modify `src/lib/sheets/records.ts` — append `line_terms_image_token` to Payment schema.
- Modify `src/lib/sheets/records.test.ts` — exact 50-column order and `AX` repository ranges.
- Modify `src/lib/sheets/migration.test.ts` — append/repair `AX1` without touching earlier cells.
- Modify `src/lib/sheets/payments.ts` — read/write Payment range through `AX`.
- Modify `src/lib/sheets/payments.test.ts` — 50-cell optimistic update range coverage.
- Modify `src/lib/sheets/payment-client-snapshot.ts` — batch-read Payments through `AX`.
- Modify `src/lib/sheets/payment-client-snapshot.test.ts` — exact batch ranges.
- Modify `src/lib/plans/schedule.ts` — initialize new payment snapshot field blank.
- Modify `src/lib/payments/generate.test.ts` — generated Payment snapshot default.
- Modify `src/lib/line/due-payments.ts` — select/freeze/preflight T&S version and build two- or three-message LINE pushes.
- Modify `src/lib/line/due-payments.test.ts` — first-plan, extension, fallback, ordering, and retry behavior.
- Modify `README.md` — Settings and LINE delivery behavior.

---

### Task 1: Pure T&S Asset Model and Settings Registry

**Files:**
- Create: `src/lib/line/terms-image.ts`
- Create: `src/lib/line/terms-image.test.ts`
- Modify: `src/lib/sheets/settings.ts`
- Modify: `src/lib/sheets/settings.test.ts`

**Interfaces:**
- Consumes: operational entries shaped as `{ key: string; value: string }` and existing `upsertOperationalSettings(entries)`.
- Produces:
  - `MAX_LINE_TERMS_IMAGE_BYTES = 1 * 1024 * 1024`
  - `LINE_TERMS_ACTIVE_VERSION_KEY = "line_terms_image_active_version"`
  - `LINE_TERMS_VERSIONS_KEY = "line_terms_image_versions"`
  - `type LineTermsImageMimeType = "image/jpeg" | "image/png"`
  - `type LineTermsImageVersion = { versionId: string; publicToken: string; driveFileId: string; mimeType: LineTermsImageMimeType; byteLength: number; originalName: string; uploadedAt: string }`
  - `type LineTermsImageState = { activeVersionId: string; versions: LineTermsImageVersion[] }`
  - `class LineTermsImageError` with stable `code`
  - `validateLineTermsImageBytes(bytes): LineTermsImageMimeType`
  - `parseLineTermsImageState(entries): LineTermsImageState`
  - `activateLineTermsImageVersion(state, version): LineTermsImageState`
  - `activeLineTermsImageVersion(state): LineTermsImageVersion | null`
  - `findLineTermsImageByPublicToken(state, token): LineTermsImageVersion | null`
  - `isLineTermsPublicToken(token): boolean`
  - `lineTermsImagePath(token): string`
  - `resolveLineTermsPlanPosition(payment, legacySchedule?): "FIRST" | "LATER" | "UNKNOWN"`
  - `isFirstPlanPayment(payment, legacySchedule?): boolean`
  - `getLineTermsImageState(): Promise<LineTermsImageState>`
  - `saveLineTermsImageVersion(version): Promise<void>`

- [ ] **Step 1: Write failing pure-domain tests**

Create `src/lib/line/terms-image.test.ts` with exact byte fixtures and registry cases:

```ts
import { describe, expect, it } from "vitest";
import {
  LINE_TERMS_ACTIVE_VERSION_KEY,
  LINE_TERMS_VERSIONS_KEY,
  MAX_LINE_TERMS_IMAGE_BYTES,
  activateLineTermsImageVersion,
  activeLineTermsImageVersion,
  findLineTermsImageByPublicToken,
  isFirstPlanPayment,
  lineTermsImagePath,
  parseLineTermsImageState,
  resolveLineTermsPlanPosition,
  validateLineTermsImageBytes,
  type LineTermsImageVersion,
} from "./terms-image";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const version: LineTermsImageVersion = {
  versionId: "terms_11111111111111111111111111111111",
  publicToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  driveFileId: "drive-file-12345",
  mimeType: "image/png",
  byteLength: png.byteLength,
  originalName: "terms.png",
  uploadedAt: "2026-08-15T01:00:00.000Z",
};

describe("LINE T&S image bytes", () => {
  it("detects JPEG and PNG from magic bytes", () => {
    expect(validateLineTermsImageBytes(jpeg)).toBe("image/jpeg");
    expect(validateLineTermsImageBytes(png)).toBe("image/png");
  });

  it("rejects empty, spoofed, and oversized data", () => {
    expect(() => validateLineTermsImageBytes(new Uint8Array())).toThrowError(/JPEG or PNG/);
    expect(() => validateLineTermsImageBytes(new Uint8Array([1, 2, 3]))).toThrowError(/JPEG or PNG/);
    const oversized = new Uint8Array(MAX_LINE_TERMS_IMAGE_BYTES + 1);
    oversized.set(png);
    expect(() => validateLineTermsImageBytes(oversized)).toThrowError(/1 MB or smaller/);
  });
});

describe("LINE T&S version registry", () => {
  it("activates a new immutable version without removing history", () => {
    const next = activateLineTermsImageVersion({ activeVersionId: "", versions: [] }, version);
    expect(next).toEqual({ activeVersionId: version.versionId, versions: [version] });
    expect(activeLineTermsImageVersion(next)).toEqual(version);
    expect(findLineTermsImageByPublicToken(next, version.publicToken)).toEqual(version);
    expect(lineTermsImagePath(version.publicToken)).toBe(`/api/line/terms-image/${version.publicToken}`);
  });

  it("rejects corrupt JSON, duplicate IDs or tokens, and missing active versions", () => {
    expect(() => parseLineTermsImageState([{ key: LINE_TERMS_VERSIONS_KEY, value: "not-json" }])).toThrowError(/configuration is invalid/);
    expect(() => parseLineTermsImageState([
      { key: LINE_TERMS_ACTIVE_VERSION_KEY, value: "missing" },
      { key: LINE_TERMS_VERSIONS_KEY, value: JSON.stringify([version]) },
    ])).toThrowError(/configuration is invalid/);
  });
});

describe("first plan payment", () => {
  it("uses payment snapshot first and schedule only for legacy blanks", () => {
    expect(isFirstPlanPayment({ installment_number: "1" }, { installment_number: "2" })).toBe(true);
    expect(isFirstPlanPayment({ installment_number: "2" }, { installment_number: "1" })).toBe(false);
    expect(isFirstPlanPayment({ installment_number: "" }, { installment_number: "1" })).toBe(true);
    expect(isFirstPlanPayment({ installment_number: "" }, undefined)).toBe(false);
    expect(resolveLineTermsPlanPosition({ installment_number: "" }, undefined)).toBe("UNKNOWN");
    expect(resolveLineTermsPlanPosition({ installment_number: "invalid" }, undefined)).toBe("UNKNOWN");
  });
});
```

- [ ] **Step 2: Run pure-domain test and verify red state**

Run: `npm test -- src/lib/line/terms-image.test.ts`

Expected: FAIL because `./terms-image` does not exist.

- [ ] **Step 3: Implement pure types, validation, registry parsing, and eligibility**

Create `src/lib/line/terms-image.ts`. Use strict validation instead of casting parsed JSON:

```ts
export const MAX_LINE_TERMS_IMAGE_BYTES = 1 * 1024 * 1024;
export const LINE_TERMS_ACTIVE_VERSION_KEY = "line_terms_image_active_version";
export const LINE_TERMS_VERSIONS_KEY = "line_terms_image_versions";

export type LineTermsImageMimeType = "image/jpeg" | "image/png";
export type LineTermsImageVersion = {
  versionId: string;
  publicToken: string;
  driveFileId: string;
  mimeType: LineTermsImageMimeType;
  byteLength: number;
  originalName: string;
  uploadedAt: string;
};
export type LineTermsImageState = { activeVersionId: string; versions: LineTermsImageVersion[] };
export type LineTermsImageErrorCode = "INVALID_FILE" | "FILE_TOO_LARGE" | "CONFIG_INVALID";

export class LineTermsImageError extends Error {
  constructor(public readonly code: LineTermsImageErrorCode, message: string) {
    super(message);
    this.name = "LineTermsImageError";
  }
}

const publicTokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const versionIdPattern = /^terms_[A-Za-z0-9_-]{32,128}$/;

export function validateLineTermsImageBytes(bytes: Uint8Array): LineTermsImageMimeType {
  if (bytes.byteLength > MAX_LINE_TERMS_IMAGE_BYTES) throw new LineTermsImageError("FILE_TOO_LARGE", "T&S image must be 1 MB or smaller.");
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  throw new LineTermsImageError("INVALID_FILE", "Choose a JPEG or PNG image.");
}

export function isLineTermsPublicToken(token: string): boolean {
  return publicTokenPattern.test(token);
}

export function lineTermsImagePath(token: string): string {
  if (!isLineTermsPublicToken(token)) throw new LineTermsImageError("CONFIG_INVALID", "T&S image configuration is invalid.");
  return `/api/line/terms-image/${encodeURIComponent(token)}`;
}

export function resolveLineTermsPlanPosition(
  payment: { installment_number: string },
  legacySchedule?: { installment_number: string },
): "FIRST" | "LATER" | "UNKNOWN" {
  const value = payment.installment_number || legacySchedule?.installment_number || "";
  if (value === "1") return "FIRST";
  return /^[2-9]\d*$/.test(value) ? "LATER" : "UNKNOWN";
}

export function isFirstPlanPayment(
  payment: { installment_number: string },
  legacySchedule?: { installment_number: string },
): boolean {
  return resolveLineTermsPlanPosition(payment, legacySchedule) === "FIRST";
}
```

Complete `parseLineTermsImageState` with field-by-field checks: exact version prefix, valid random token, non-empty Drive file ID, supported MIME, safe positive byte length no greater than max, basename-only non-empty original name no longer than 120 characters, valid ISO timestamp, unique version IDs, unique public tokens, and active ID present in registry. `activateLineTermsImageVersion` must reject duplicate ID/token and return a new array.

- [ ] **Step 4: Run pure-domain test and verify green state**

Run: `npm test -- src/lib/line/terms-image.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing Settings registry tests**

Extend `src/lib/sheets/settings.test.ts`:

```ts
it("loads and atomically activates a T&S image version", async () => {
  mocks.get
    .mockResolvedValueOnce({ data: { values: [["key", "value"]] } })
    .mockResolvedValueOnce({ data: { values: [["key", "value"]] } });

  const version = {
    versionId: "terms_11111111111111111111111111111111",
    publicToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    driveFileId: "drive-file-12345",
    mimeType: "image/png" as const,
    byteLength: 9,
    originalName: "terms.png",
    uploadedAt: "2026-08-15T01:00:00.000Z",
  };

  await saveLineTermsImageVersion(version);

  expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
    requestBody: expect.objectContaining({ data: expect.arrayContaining([
      expect.objectContaining({ values: [["line_terms_image_active_version", version.versionId]] }),
      expect.objectContaining({ values: [["line_terms_image_versions", JSON.stringify([version])]] }),
    ]) }),
  }));
});

it("rejects corrupt stored T&S metadata before writing", async () => {
  mocks.get.mockResolvedValueOnce({ data: { values: [["key", "value"], ["line_terms_image_versions", "not-json"]] } });
  await expect(getLineTermsImageState()).rejects.toThrow(/configuration is invalid/);
  expect(mocks.batchUpdate).not.toHaveBeenCalled();
});
```

Import `getLineTermsImageState` and `saveLineTermsImageVersion` in this test.

- [ ] **Step 6: Run Settings test and verify red state**

Run: `npm test -- src/lib/sheets/settings.test.ts`

Expected: FAIL because registry repository functions are missing.

- [ ] **Step 7: Add Settings repository functions**

Modify `src/lib/sheets/settings.ts`:

```ts
export async function getLineTermsImageState(): Promise<LineTermsImageState> {
  return parseLineTermsImageState(await listOperationalSettings());
}

export async function saveLineTermsImageVersion(version: LineTermsImageVersion): Promise<void> {
  const current = await getLineTermsImageState();
  const next = activateLineTermsImageVersion(current, version);
  await upsertOperationalSettings([
    { key: LINE_TERMS_ACTIVE_VERSION_KEY, value: next.activeVersionId },
    { key: LINE_TERMS_VERSIONS_KEY, value: JSON.stringify(next.versions) },
  ]);
}
```

Import exact types/constants/functions from `@/lib/line/terms-image`. Empty settings must parse as `{ activeVersionId: "", versions: [] }`.

- [ ] **Step 8: Run Task 1 tests**

Run: `npm test -- src/lib/line/terms-image.test.ts src/lib/sheets/settings.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 1 if its paths were clean at execution baseline**

```bash
git add src/lib/line/terms-image.ts src/lib/line/terms-image.test.ts src/lib/sheets/settings.ts src/lib/sheets/settings.test.ts
git commit -m "feat: add LINE terms image registry"
```

If either modified Settings path was dirty at baseline, skip this entire task commit.

---

### Task 2: Drive Asset I/O and Versioned Upload Service

**Files:**
- Modify: `src/lib/storage/drive-client.ts`
- Modify: `src/lib/storage/drive-client.test.ts`
- Create: `src/lib/line/terms-image-upload.ts`
- Create: `src/lib/line/terms-image-upload.test.ts`

**Interfaces:**
- Consumes: Task 1 `validateLineTermsImageBytes`, `LineTermsImageVersion`, and `saveLineTermsImageVersion`; existing `getSlipStorageFolder()` returns the same configured folder chosen during Workspace setup.
- Produces:
  - `createDriveTermsImageFile({ bytes, mimeType, versionId, folderId }, { drive? }): Promise<string>`
  - `readDriveTermsImageFile(fileId, { drive? }): Promise<{ bytes: Uint8Array; declaredMimeType: string }>`
  - `uploadLineTermsImage({ bytes, originalName }, dependencies?): Promise<LineTermsImageVersion>`

- [ ] **Step 1: Write failing Drive boundary tests**

Extend `src/lib/storage/drive-client.test.ts`:

```ts
describe("LINE T&S Drive assets", () => {
  it("creates an immutable image in the configured folder", async () => {
    const { drive, create } = driveWith({ createdId: "terms-file-12345" });
    await expect(createDriveTermsImageFile({
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      mimeType: "image/png",
      versionId: "terms_11111111111111111111111111111111",
      folderId: "folder-12345",
    }, { drive })).resolves.toBe("terms-file-12345");

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: {
        name: "line-terms-terms_11111111111111111111111111111111.png",
        parents: ["folder-12345"],
        mimeType: "image/png",
      },
      fields: "id",
      supportsAllDrives: true,
    }));
  });

  it("reads registered image bytes without returning Google metadata", async () => {
    const get = vi.fn().mockResolvedValue({ data: new Uint8Array([0xff, 0xd8, 0xff]).buffer, headers: { "content-type": "image/jpeg" } });
    const drive = { files: { get } } as unknown as DriveClientLike;
    await expect(readDriveTermsImageFile("terms-file-12345", { drive })).resolves.toEqual({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      declaredMimeType: "image/jpeg",
    });
    expect(get).toHaveBeenCalledWith({ fileId: "terms-file-12345", alt: "media", supportsAllDrives: true });
  });

  it("sanitizes create and read failures", async () => {
    const drive = driveWith({ getError: new Error("private Google body") }).drive;
    await expect(readDriveTermsImageFile("terms-file-12345", { drive })).rejects.toThrow("T&S image is unavailable.");
  });
});
```

Add imports for `createDriveTermsImageFile` and `readDriveTermsImageFile`.

- [ ] **Step 2: Run Drive tests and verify red state**

Run: `npm test -- src/lib/storage/drive-client.test.ts`

Expected: FAIL because T&S Drive functions are missing.

- [ ] **Step 3: Implement narrow Drive create/read functions**

Add to `src/lib/storage/drive-client.ts`:

```ts
export async function createDriveTermsImageFile(input: {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  versionId: string;
  folderId: string;
}, { drive }: { drive?: DriveClientLike } = {}): Promise<string> {
  try {
    const configuredDrive = drive ?? await getConfiguredDriveClient();
    const extension = input.mimeType === "image/png" ? "png" : "jpg";
    const created = await configuredDrive.files.create({
      requestBody: { name: `line-terms-${input.versionId}.${extension}`, parents: [input.folderId], mimeType: input.mimeType },
      media: { mimeType: input.mimeType, body: Readable.from(Buffer.from(input.bytes)) },
      fields: "id",
      supportsAllDrives: true,
    });
    if (!created.data.id) throw new Error("missing file id");
    return created.data.id;
  } catch {
    throw new Error("Could not store T&S image. Try again.");
  }
}

export async function readDriveTermsImageFile(fileId: string, { drive }: { drive?: DriveClientLike } = {}): Promise<{ bytes: Uint8Array; declaredMimeType: string }> {
  try {
    const configuredDrive = drive ?? await getConfiguredDriveClient();
    const file = await configuredDrive.files.get({ fileId, alt: "media", supportsAllDrives: true });
    const bytes = file.data instanceof ArrayBuffer
      ? new Uint8Array(file.data)
      : file.data instanceof Uint8Array
        ? new Uint8Array(file.data)
        : null;
    if (!bytes) throw new Error("invalid media body");
    return { bytes, declaredMimeType: file.headers?.["content-type"] ?? "" };
  } catch {
    throw new Error("T&S image is unavailable.");
  }
}
```

Expand `DriveClientLike.files.get` response data type to include `Uint8Array`; keep all existing folder/slip behavior unchanged.

- [ ] **Step 4: Run Drive tests and verify green state**

Run: `npm test -- src/lib/storage/drive-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing upload-service tests**

Create `src/lib/line/terms-image-upload.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { uploadLineTermsImage } from "./terms-image-upload";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function dependencies() {
  return {
    getFolder: vi.fn().mockResolvedValue({ folderId: "folder-12345", folderName: "Payment files", source: "oauth" as const }),
    createFile: vi.fn().mockResolvedValue("terms-file-12345"),
    saveVersion: vi.fn().mockResolvedValue(undefined),
    createId: vi.fn().mockReturnValueOnce("11111111111111111111111111111111").mockReturnValueOnce("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    now: vi.fn().mockReturnValue("2026-08-15T01:00:00.000Z"),
  };
}

it("stores bytes before activating their immutable metadata", async () => {
  const deps = dependencies();
  const result = await uploadLineTermsImage({ bytes: png, originalName: "terms.png" }, deps);

  expect(result).toMatchObject({
    versionId: "terms_11111111111111111111111111111111",
    publicToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    driveFileId: "terms-file-12345",
    mimeType: "image/png",
    byteLength: png.byteLength,
  });
  expect(deps.createFile.mock.invocationCallOrder[0]).toBeLessThan(deps.saveVersion.mock.invocationCallOrder[0]);
  expect(deps.createFile).toHaveBeenCalledWith(expect.objectContaining({ folderId: "folder-12345", bytes: png }));
  expect(deps.saveVersion).toHaveBeenCalledWith(result);
});

it("does not activate metadata when Drive creation fails", async () => {
  const deps = dependencies();
  deps.createFile.mockRejectedValue(new Error("private Google body"));
  await expect(uploadLineTermsImage({ bytes: png, originalName: "terms.png" }, deps)).rejects.toThrow("Could not store T&S image. Try again.");
  expect(deps.saveVersion).not.toHaveBeenCalled();
});

it("rejects invalid bytes before reading configured Drive state", async () => {
  const deps = dependencies();
  await expect(uploadLineTermsImage({ bytes: new Uint8Array([1]), originalName: "fake.png" }, deps)).rejects.toThrow("Choose a JPEG or PNG image.");
  expect(deps.getFolder).not.toHaveBeenCalled();
  expect(deps.createFile).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run upload-service test and verify red state**

Run: `npm test -- src/lib/line/terms-image-upload.test.ts`

Expected: FAIL because upload service is missing.

- [ ] **Step 7: Implement upload orchestration**

Create `src/lib/line/terms-image-upload.ts` with injectable dependencies:

```ts
import { randomUUID } from "node:crypto";
import { saveLineTermsImageVersion } from "@/lib/sheets/settings";
import { getSlipStorageFolder } from "@/lib/storage/drive-folder";
import { createDriveTermsImageFile } from "@/lib/storage/drive-client";
import { validateLineTermsImageBytes, type LineTermsImageVersion } from "./terms-image";

type UploadDependencies = {
  getFolder: typeof getSlipStorageFolder;
  createFile: typeof createDriveTermsImageFile;
  saveVersion: typeof saveLineTermsImageVersion;
  createId: () => string;
  now: () => string;
};

const runtimeDependencies: UploadDependencies = {
  getFolder: getSlipStorageFolder,
  createFile: createDriveTermsImageFile,
  saveVersion: saveLineTermsImageVersion,
  createId: () => randomUUID().replaceAll("-", ""),
  now: () => new Date().toISOString(),
};

export async function uploadLineTermsImage(
  input: { bytes: Uint8Array; originalName: string },
  dependencies: UploadDependencies = runtimeDependencies,
): Promise<LineTermsImageVersion> {
  const mimeType = validateLineTermsImageBytes(input.bytes);
  const originalName = input.originalName.trim().split(/[\\/]/).at(-1)?.slice(0, 120) || (mimeType === "image/png" ? "terms.png" : "terms.jpg");
  const folder = await dependencies.getFolder();
  const versionId = `terms_${dependencies.createId()}`;
  const publicToken = dependencies.createId();
  const driveFileId = await dependencies.createFile({ bytes: input.bytes, mimeType, versionId, folderId: folder.folderId });
  const version: LineTermsImageVersion = { versionId, publicToken, driveFileId, mimeType, byteLength: input.bytes.byteLength, originalName, uploadedAt: dependencies.now() };
  await dependencies.saveVersion(version);
  return version;
}
```

Let stable validation/Drive errors pass through; callers sanitize unknown errors.

- [ ] **Step 8: Run Task 2 tests**

Run: `npm test -- src/lib/storage/drive-client.test.ts src/lib/line/terms-image-upload.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 2 if its paths were clean at execution baseline**

```bash
git add src/lib/storage/drive-client.ts src/lib/storage/drive-client.test.ts src/lib/line/terms-image-upload.ts src/lib/line/terms-image-upload.test.ts
git commit -m "feat: store versioned LINE terms images"
```

If either modified Drive path was dirty at baseline, skip this entire task commit.

---

### Task 3: Protected Settings Upload and Preview

**Files:**
- Create: `src/app/admin/(protected)/settings/terms-image-actions.ts`
- Create: `src/app/admin/(protected)/settings/terms-image-actions.test.ts`
- Create: `src/components/admin/line-terms-image-form.tsx`
- Create: `src/components/admin/line-terms-image-form.test.tsx`
- Modify: `src/app/admin/(protected)/settings/page.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: Task 1 active-version helpers, Task 2 `uploadLineTermsImage`, existing `requireAdmin`, `appendAudit`, `revalidatePath`, and active Workspace connection state.
- Produces:
  - `type LineTermsImageActionResult = { ok: boolean; status: "SAVED" | "FAILED"; message: string }`
  - `uploadLineTermsImageAction(formData): Promise<LineTermsImageActionResult>`
  - `LineTermsImageForm({ image, driveConnected, error?, action })`

- [ ] **Step 1: Write failing server-action tests**

Create `src/app/admin/(protected)/settings/terms-image-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  uploadLineTermsImage: vi.fn(),
  appendAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/line/terms-image-upload", () => ({ uploadLineTermsImage: mocks.uploadLineTermsImage }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { uploadLineTermsImageAction } from "./terms-image-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.uploadLineTermsImage.mockResolvedValue({
    versionId: "terms_11111111111111111111111111111111",
    publicToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    driveFileId: "terms-file-12345",
    mimeType: "image/png",
    byteLength: 8,
    originalName: "terms.png",
    uploadedAt: "2026-08-15T01:00:00.000Z",
  });
  mocks.appendAudit.mockResolvedValue(undefined);
});

it("requires admin, uploads bytes, audits safe metadata, and revalidates Settings", async () => {
  const formData = new FormData();
  formData.set("terms_image", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "terms.png", { type: "image/png" }));

  await expect(uploadLineTermsImageAction(formData)).resolves.toEqual({ ok: true, status: "SAVED", message: "T&S image saved." });
  expect(mocks.requireAdmin).toHaveBeenCalledOnce();
  expect(mocks.uploadLineTermsImage).toHaveBeenCalledWith(expect.objectContaining({ originalName: "terms.png", bytes: expect.any(Uint8Array) }));
  expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: "LINE_TERMS_IMAGE_SAVED",
    metadata: JSON.stringify({ versionId: "terms_11111111111111111111111111111111", mimeType: "image/png", byteLength: 8 }),
  }));
  expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("terms-file-12345");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
});

it("returns a safe validation failure and does not audit", async () => {
  mocks.uploadLineTermsImage.mockRejectedValue(new Error("private Google body"));
  const formData = new FormData();
  formData.set("terms_image", new File(["bad"], "terms.png", { type: "image/png" }));
  await expect(uploadLineTermsImageAction(formData)).resolves.toEqual({ ok: false, status: "FAILED", message: "Could not save T&S image. Try again." });
  expect(mocks.appendAudit).not.toHaveBeenCalled();
});
```

Add one missing-file case returning `Choose a JPEG or PNG image.` without calling upload service.

- [ ] **Step 2: Run action test and verify red state**

Run: `npm test -- src/app/admin/'(protected)'/settings/terms-image-actions.test.ts`

Expected: FAIL because action module is missing.

- [ ] **Step 3: Implement authenticated upload action**

Create `src/app/admin/(protected)/settings/terms-image-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { LineTermsImageError } from "@/lib/line/terms-image";
import { uploadLineTermsImage } from "@/lib/line/terms-image-upload";
import { appendAudit } from "@/lib/sheets/payments";

export type LineTermsImageActionResult = { ok: boolean; status: "SAVED" | "FAILED"; message: string };

export async function uploadLineTermsImageAction(formData: FormData): Promise<LineTermsImageActionResult> {
  await requireAdmin();
  const file = formData.get("terms_image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, status: "FAILED", message: "Choose a JPEG or PNG image." };
  try {
    const version = await uploadLineTermsImage({ bytes: new Uint8Array(await file.arrayBuffer()), originalName: file.name });
    await appendAudit({
      paymentId: "",
      clientId: "",
      action: "LINE_TERMS_IMAGE_SAVED",
      previousStatus: "line_terms_image_active_version",
      newStatus: version.versionId,
      reason: "LINE T&S image updated",
      source: "ADMIN",
      metadata: JSON.stringify({ versionId: version.versionId, mimeType: version.mimeType, byteLength: version.byteLength }),
    });
    revalidatePath("/admin/settings");
    return { ok: true, status: "SAVED", message: "T&S image saved." };
  } catch (error) {
    const message = error instanceof LineTermsImageError ? error.message : "Could not save T&S image. Try again.";
    return { ok: false, status: "FAILED", message };
  }
}
```

Do not include file names, tokens, IDs, bytes, or thrown provider text in the returned failure.

- [ ] **Step 4: Run action test and verify green state**

Run: `npm test -- src/app/admin/'(protected)'/settings/terms-image-actions.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing Settings component tests**

Create `src/components/admin/line-terms-image-form.test.tsx`:

```tsx
/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LineTermsImageForm } from "./line-terms-image-form";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows upload guidance and disables upload without configured Drive", () => {
  render(createElement(LineTermsImageForm, { image: null, driveConnected: false, action: vi.fn() }));
  expect(screen.getByText(/same connected Google Drive folder/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Upload T&S image" })).toBeDisabled();
});

it("shows corrupt stored configuration safely", () => {
  render(createElement(LineTermsImageForm, { image: null, driveConnected: true, error: "T&S image configuration needs attention.", action: vi.fn() }));
  expect(screen.getByText("T&S image configuration needs attention.")).toBeTruthy();
});

it("shows current preview and submits a replacement file", async () => {
  const action = vi.fn().mockResolvedValue({ ok: true, status: "SAVED", message: "T&S image saved." });
  render(createElement(LineTermsImageForm, {
    image: { previewUrl: "/api/line/terms-image/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", uploadedAt: "2026-08-15T01:00:00.000Z" },
    driveConnected: true,
    action,
  }));
  expect(screen.getByRole("img", { name: "Current terms and conditions" })).toBeTruthy();
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "replacement.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("T&S image"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Replace T&S image" }));
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect((action.mock.calls[0][0] as FormData).get("terms_image")).toBe(file);
  expect(screen.getByText("T&S image saved.")).toBeTruthy();
});
```

- [ ] **Step 6: Run component test and verify red state**

Run: `npm test -- src/components/admin/line-terms-image-form.test.tsx`

Expected: FAIL because component is missing.

- [ ] **Step 7: Implement card, page integration, and upload body limit**

Create `src/components/admin/line-terms-image-form.tsx` as a focused client component. Use existing `Card`, `Field`, `FieldLabel`, `FieldDescription`, `Input`, and `Button`; use `next/image` with `unoptimized` for the current preview. Build `FormData` from the form in `onSubmit`, call the action inside `useTransition`, show its safe message, reset the file input after success, and use labels exactly exercised above.

Modify Settings page to resolve the active version from its existing `listOperationalSettings()` result, avoiding a second Sheets read:

```ts
let termsImage: { previewUrl: string; uploadedAt: string } | null = null;
let termsImageError = "";
try {
  const activeTermsImage = activeLineTermsImageVersion(parseLineTermsImageState(settings));
  termsImage = activeTermsImage ? {
    previewUrl: lineTermsImagePath(activeTermsImage.publicToken),
    uploadedAt: activeTermsImage.uploadedAt,
  } : null;
} catch {
  termsImageError = "T&S image configuration needs attention.";
}
```

Render `LineTermsImageForm` near the LINE message editor with `driveConnected={Boolean(connection)}`, `error={termsImageError}`, and `action={uploadLineTermsImageAction}`.

Modify `next.config.ts` without changing existing OCR tracing:

```ts
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
  // existing outputFileTracingIncludes remains unchanged
};
```

- [ ] **Step 8: Run Task 3 tests and type/lint checks for touched UI**

Run: `npm test -- src/app/admin/'(protected)'/settings/terms-image-actions.test.ts src/components/admin/line-terms-image-form.test.tsx`

Expected: PASS.

Run: `npx eslint src/app/admin/'(protected)'/settings/terms-image-actions.ts src/app/admin/'(protected)'/settings/page.tsx src/components/admin/line-terms-image-form.tsx next.config.ts`

Expected: exit 0.

- [ ] **Step 9: Commit Task 3 if its paths were clean at execution baseline**

```bash
git add src/app/admin/'(protected)'/settings/terms-image-actions.ts src/app/admin/'(protected)'/settings/terms-image-actions.test.ts src/components/admin/line-terms-image-form.tsx src/components/admin/line-terms-image-form.test.tsx src/app/admin/'(protected)'/settings/page.tsx next.config.ts
git commit -m "feat: upload LINE terms image in settings"
```

If Settings page or config was dirty at baseline, skip this entire task commit.

---

### Task 4: Registered Public Image Route

**Files:**
- Create: `src/app/api/line/terms-image/[publicToken]/route.ts`
- Create: `src/app/api/line/terms-image/[publicToken]/route.test.ts`

**Interfaces:**
- Consumes: Task 1 token validation/registry lookup and Task 2 Drive byte read.
- Produces: unauthenticated `GET` returning only a registered T&S asset with immutable cache headers.

- [ ] **Step 1: Write failing route tests**

Create `src/app/api/line/terms-image/[publicToken]/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getState: vi.fn(), readFile: vi.fn() }));
vi.mock("@/lib/sheets/settings", () => ({ getLineTermsImageState: mocks.getState }));
vi.mock("@/lib/storage/drive-client", () => ({ readDriveTermsImageFile: mocks.readFile }));

import { GET } from "./route";

const token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const version = {
  versionId: "terms_11111111111111111111111111111111",
  publicToken: token,
  driveFileId: "terms-file-12345",
  mimeType: "image/png" as const,
  byteLength: 8,
  originalName: "terms.png",
  uploadedAt: "2026-08-15T01:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getState.mockResolvedValue({ activeVersionId: version.versionId, versions: [version] });
  mocks.readFile.mockResolvedValue({ bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), declaredMimeType: "image/png" });
});

describe("public LINE T&S image", () => {
  it("serves a registered historical or active token with immutable headers", async () => {
    const response = await GET(new Request(`https://pay.example/api/line/terms-image/${token}`), { params: Promise.resolve({ publicToken: token }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.readFile).toHaveBeenCalledWith("terms-file-12345");
  });

  it("rejects malformed and unknown tokens before Drive access", async () => {
    const malformed = await GET(new Request("https://pay.example/api/line/terms-image/bad"), { params: Promise.resolve({ publicToken: "bad" }) });
    expect(malformed.status).toBe(404);
    expect(mocks.getState).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();

    mocks.getState.mockResolvedValueOnce({ activeVersionId: version.versionId, versions: [version] });
    const unknownToken = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const unknown = await GET(new Request(`https://pay.example/api/line/terms-image/${unknownToken}`), { params: Promise.resolve({ publicToken: unknownToken }) });
    expect(unknown.status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("returns a generic unavailable response for Drive or byte-validation failures", async () => {
    mocks.readFile.mockRejectedValueOnce(new Error("private Google body"));
    const response = await GET(new Request(`https://pay.example/api/line/terms-image/${token}`), { params: Promise.resolve({ publicToken: token }) });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Service Unavailable");
  });
});
```

Add a case where Drive returns bytes whose magic type differs from stored `mimeType`; expect `503`.

- [ ] **Step 2: Run route test and verify red state**

Run: `npm test -- src/app/api/line/terms-image/'[publicToken]'/route.test.ts`

Expected: FAIL because route is missing.

- [ ] **Step 3: Implement registry-restricted public route**

Create `src/app/api/line/terms-image/[publicToken]/route.ts`:

```ts
import { findLineTermsImageByPublicToken, isLineTermsPublicToken, validateLineTermsImageBytes } from "@/lib/line/terms-image";
import { getLineTermsImageState } from "@/lib/sheets/settings";
import { readDriveTermsImageFile } from "@/lib/storage/drive-client";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ publicToken: string }> }): Promise<Response> {
  const { publicToken } = await params;
  if (!isLineTermsPublicToken(publicToken)) return new Response("Not Found", { status: 404 });
  try {
    const version = findLineTermsImageByPublicToken(await getLineTermsImageState(), publicToken);
    if (!version) return new Response("Not Found", { status: 404 });
    const file = await readDriveTermsImageFile(version.driveFileId);
    const detectedMimeType = validateLineTermsImageBytes(file.bytes);
    if (detectedMimeType !== version.mimeType || file.bytes.byteLength !== version.byteLength) return new Response("Service Unavailable", { status: 503 });
    return new Response(file.bytes, { headers: {
      "Content-Type": detectedMimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("Service Unavailable", { status: 503 });
  }
}
```

Unknown registered-token lookup stays `404`; corrupt Settings and registered file failures stay sanitized `503`.

- [ ] **Step 4: Run route tests and verify green state**

Run: `npm test -- src/app/api/line/terms-image/'[publicToken]'/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Run adjacent private-slip regression tests**

Run: `npm test -- src/app/api/admin/slips/'[paymentId]'/route.test.ts src/lib/storage/drive-client.test.ts`

Expected: PASS; admin slip route remains authenticated and `private, no-store`.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/app/api/line/terms-image/'[publicToken]'/route.ts src/app/api/line/terms-image/'[publicToken]'/route.test.ts
git commit -m "feat: serve registered LINE terms images"
```

---

### Task 5: Payment Snapshot Column and Workbook Migration

**Files:**
- Modify: `src/lib/sheets/records.ts`
- Modify: `src/lib/sheets/records.test.ts`
- Modify: `src/lib/sheets/migration.test.ts`
- Modify: `src/lib/sheets/payments.ts`
- Modify: `src/lib/sheets/payments.test.ts`
- Modify: `src/lib/sheets/payment-client-snapshot.ts`
- Modify: `src/lib/sheets/payment-client-snapshot.test.ts`
- Modify: `src/lib/plans/schedule.ts`
- Modify: `src/lib/payments/generate.test.ts`

**Interfaces:**
- Consumes: existing append-only Payment schema migration and `buildPaymentForSchedule`.
- Produces: `PaymentRecord.line_terms_image_token: string`, with blank new-row default and `Payments!A:AX` repository range.

- [ ] **Step 1: Change exact schema/range tests to the desired 50-column behavior**

In `src/lib/sheets/records.test.ts`, append `"line_terms_image_token"` to the exact header array, change length `49` to `50`, column labels `AW` to `AX`, metadata `columnCount` to `50`, and expected `endColumnIndex` to `50`:

```ts
expect(PAYMENT_HEADERS.at(-1)).toBe("line_terms_image_token");
expect(PAYMENT_HEADERS).toHaveLength(50);
expect(get).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", range: "Payments!A:AX" });
expect(append).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!A:AX" }));
```

In `src/lib/sheets/migration.test.ts`, expect `Payments!A1:AX1`, a one-column expansion from 49 to 50, and blank `AX1` filled with `line_terms_image_token` while populated legacy cells stay unchanged.

In `src/lib/sheets/payments.test.ts`, change exact `AW` ranges and `endColumnIndex: 49` assertions to `AX` and `50`.

In `src/lib/sheets/payment-client-snapshot.test.ts`, expect:

```ts
ranges: ["Payments!A:AX", "Clients!A:W", "Installment Schedule!A:R"]
```

In `src/lib/payments/generate.test.ts`, add:

```ts
expect(appendPayment).toHaveBeenCalledWith(expect.objectContaining({ line_terms_image_token: "" }));
```

- [ ] **Step 2: Run schema tests and verify red state**

Run: `npm test -- src/lib/sheets/records.test.ts src/lib/sheets/migration.test.ts src/lib/sheets/payments.test.ts src/lib/sheets/payment-client-snapshot.test.ts src/lib/payments/generate.test.ts`

Expected: FAIL on 49-column headers/ranges and missing generated field.

- [ ] **Step 3: Append field and update every Payment range**

Modify `src/lib/sheets/records.ts` so `PAYMENT_HEADERS` ends:

```ts
"package_name", "payment_type", "installment_number", "installment_count", "total_price_thb", "line_terms_image_token"
```

Change these repository ranges:

- `src/lib/sheets/payments.ts`: `Payments!A:AW` → `Payments!A:AX`; row read `A<row>:AW<row>` → `A<row>:AX<row>`; append range through `AX`.
- `src/lib/sheets/payment-client-snapshot.ts`: batch range `Payments!A:AX`.

`ensurePaymentSchema()` already uses `PAYMENT_HEADERS.length` and fills appended columns from index 30, so production migration logic needs no algorithm change.

Modify `buildPaymentForSchedule` in `src/lib/plans/schedule.ts` so returned object ends with:

```ts
total_price_thb: String(input.planTotalSatang / 100),
line_terms_image_token: "",
```

- [ ] **Step 4: Search for stale range literals**

Run: `rg -n 'Payments!.*AW|AW1|endColumnIndex: 49|HaveLength\(49\)' src`

Expected: no output. Do not change `AW` strings unrelated to Payments.

- [ ] **Step 5: Run Task 5 tests**

Run: `npm test -- src/lib/sheets/records.test.ts src/lib/sheets/migration.test.ts src/lib/sheets/payments.test.ts src/lib/sheets/payment-client-snapshot.test.ts src/lib/payments/generate.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 5 if its paths were clean at execution baseline**

```bash
git add src/lib/sheets/records.ts src/lib/sheets/records.test.ts src/lib/sheets/migration.test.ts src/lib/sheets/payments.ts src/lib/sheets/payments.test.ts src/lib/sheets/payment-client-snapshot.ts src/lib/sheets/payment-client-snapshot.test.ts src/lib/plans/schedule.ts src/lib/payments/generate.test.ts
git commit -m "feat: snapshot LINE terms image selection"
```

If any modified schema/repository path was dirty at baseline, skip this entire task commit.

---

### Task 6: First-Plan LINE Delivery and Non-Blocking Fallback

**Files:**
- Modify: `src/lib/line/due-payments.ts`
- Modify: `src/lib/line/due-payments.test.ts`

**Interfaces:**
- Consumes: Task 1 state/eligibility/path helpers, Task 2 Drive read, Task 5 `PaymentRecord.line_terms_image_token`, current frozen `line_message`/`line_retry_key`, and existing `sendPush({ messages })`.
- Produces: three-message push for first-plan payments with usable asset; unchanged two-message push otherwise; safe `LINE_TERMS_IMAGE_SKIPPED` audit.

- [ ] **Step 1: Extend test dependencies and write failing delivery cases**

Add to the test dependency factory:

```ts
getLineTermsImageState: vi.fn().mockResolvedValue({ activeVersionId: termsVersion.versionId, versions: [termsVersion] }),
readDriveTermsImageFile: vi.fn().mockResolvedValue({ bytes: termsPng, declaredMimeType: "image/png" }),
```

Also add both mocks to the factory's returned intersection type so later tests can call `.mockResolvedValue` and `.mockRejectedValue` without casts:

```ts
getLineTermsImageState: ReturnType<typeof vi.fn>;
readDriveTermsImageFile: ReturnType<typeof vi.fn>;
```

Use:

```ts
const termsPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const termsVersion = {
  versionId: "terms_11111111111111111111111111111111",
  publicToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  driveFileId: "terms-file-12345",
  mimeType: "image/png" as const,
  byteLength: termsPng.byteLength,
  originalName: "terms.png",
  uploadedAt: "2026-08-15T01:00:00.000Z",
};
```

Add exact behavioral tests:

```ts
it("sends text, QR, then frozen T&S image for installment one", async () => {
  const deps = dependencies([payment({ payment_type: "INSTALLMENTS", installment_number: "1", installment_count: "3" })]);
  await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);
  expect(deps.sendPush.mock.calls[0]?.[0].messages).toEqual([
    expect.objectContaining({ type: "text" }),
    { type: "image", originalContentUrl: "https://pay.example/api/payments/token_1/promptpay-qr.png", previewImageUrl: "https://pay.example/api/payments/token_1/promptpay-qr.png" },
    { type: "image", originalContentUrl: `https://pay.example/api/line/terms-image/${termsVersion.publicToken}`, previewImageUrl: `https://pay.example/api/line/terms-image/${termsVersion.publicToken}` },
  ]);
  expect(deps.updatePayment).toHaveBeenCalledWith(expect.objectContaining({ line_terms_image_token: termsVersion.publicToken }));
});

it("uses each extension plan's installment one and skips later installments", async () => {
  const deps = dependencies([
    payment({ payment_id: "pay_extension_1", installment_number: "1", rowNumber: 2 }),
    payment({ payment_id: "pay_extension_2", installment_number: "2", rowNumber: 3 }),
  ]);
  await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);
  expect(deps.sendPush.mock.calls[0]?.[0].messages).toHaveLength(3);
  expect(deps.sendPush.mock.calls[1]?.[0].messages).toHaveLength(2);
  expect(deps.getLineTermsImageState).toHaveBeenCalledTimes(1);
});

it("falls back to text and QR and freezes NONE when active image is unavailable", async () => {
  const deps = dependencies([payment({ installment_number: "1" })]);
  deps.readDriveTermsImageFile.mockRejectedValue(new Error("private Google body"));
  await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ accepted: ["pay_1"] });
  expect(deps.sendPush.mock.calls[0]?.[0].messages).toHaveLength(2);
  expect(deps.updatePayment).toHaveBeenCalledWith(expect.objectContaining({ line_terms_image_token: "NONE" }));
  expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: "LINE_TERMS_IMAGE_SKIPPED",
    metadata: JSON.stringify({ paymentId: "pay_1", reasonCode: "ASSET_UNAVAILABLE" }),
  }));
  expect(JSON.stringify(deps.appendAudit.mock.calls)).not.toContain("terms-file-12345");
});

it("reuses the frozen old token after active image replacement", async () => {
  const deps = dependencies([payment({
    installment_number: "1",
    line_message_status: "FAILED_RETRYABLE",
    line_retry_key: "stored-key",
    line_message: "Frozen message",
    line_terms_image_token: termsVersion.publicToken,
  })]);
  deps.getLineTermsImageState.mockResolvedValue({ activeVersionId: "terms_new", versions: [] });
  await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);
  expect(deps.getLineTermsImageState).not.toHaveBeenCalled();
  expect(deps.readDriveTermsImageFile).not.toHaveBeenCalled();
  expect(deps.sendPush.mock.calls[0]?.[0].messages[2]).toMatchObject({ originalContentUrl: expect.stringContaining(termsVersion.publicToken) });
});
```

Also add cases for one-time payment, manual plan position `1`, legacy Schedule fallback when Payment snapshot is blank, missing configuration → `NONE`/`NOT_CONFIGURED`, corrupt registry → `NONE`/`CONFIG_INVALID`, unknown legacy position → no T&S, and legacy frozen retry with blank new column → treat as `NONE` without selecting current image.

Update the existing `delivers catch-up payments...` exact message-array expectation to include the T&S image as its third entry because its default fixture is a first one-time payment and the factory now supplies a healthy active asset. Existing accepted audit expectations remain the same because successful T&S inclusion does not add a separate audit action.

- [ ] **Step 2: Run sender tests and verify red state**

Run: `npm test -- src/lib/line/due-payments.test.ts`

Expected: FAIL because dependencies and third-message behavior are missing.

- [ ] **Step 3: Add runtime dependencies and pure URL builder**

Modify `LineDueDependencies`:

```ts
getLineTermsImageState: typeof getLineTermsImageState;
readDriveTermsImageFile: typeof readDriveTermsImageFile;
```

Wire them in `runtimeDependencies()`. Preserve one operational-Settings read per sender run by sharing one promise between existing profile resolution and T&S state resolution:

```ts
let operationalSettingsPromise: ReturnType<typeof listOperationalSettings> | null = null;
const operationalSettings = () => operationalSettingsPromise ??= listOperationalSettings();

return {
  // existing dependencies
  getLineDueMessageProfiles: async () => resolveLineDueMessageProfiles(await operationalSettings()),
  getLineTermsImageState: async () => parseLineTermsImageState(await operationalSettings()),
  readDriveTermsImageFile,
};
```

Import `listOperationalSettings` and `resolveLineDueMessageProfiles` from Sheets settings. Remove the direct runtime import/use of `getLineDueMessageProfiles`; keep the dependency property name unchanged so existing injected tests remain focused.

Add:

```ts
function termsImageUrl(baseUrl: string, publicToken: string): string {
  const url = new URL(lineTermsImagePath(publicToken), baseUrl);
  if (url.protocol !== "https:") throw new Error("HTTPS_BASE_URL_REQUIRED");
  return url.toString();
}
```

Keep existing QR URL logic unchanged.

- [ ] **Step 4: Implement frozen T&S selection**

Before LINE attempts, resolve linked Schedule and plan position once:

```ts
const legacySchedule = schedules.find((item) => item.payment_id === payment.payment_id);
const termsPlanPosition = resolveLineTermsPlanPosition(payment, legacySchedule);
const qualifiesForTerms = termsPlanPosition === "FIRST";
```

Use this decision contract:

```ts
type TermsDecision = {
  frozenToken: string;
  skipReason: "NOT_CONFIGURED" | "CONFIG_INVALID" | "ASSET_UNAVAILABLE" | "POSITION_UNKNOWN" | "";
};
```

Rules:

1. Known later payment → `{ frozenToken: "NONE", skipReason: "" }`; do not load Settings or Drive and leave payment column blank until the attempt is frozen.
2. Unknown or malformed installment position → `{ frozenToken: "NONE", skipReason: "POSITION_UNKNOWN" }`; do not load Settings or Drive and write one safe skip audit before sending.
3. Existing retry key plus a valid stored token → reuse that token without loading Settings/Drive; stored `NONE` remains `NONE`.
4. Existing retry key plus blank token (legacy attempt) → `NONE` without loading Settings/Drive.
5. Existing retry key plus a malformed stored token → `NONE/CONFIG_INVALID`; never build a URL from it.
6. First qualifying attempt → load state; no active version gives `NONE/NOT_CONFIGURED`; parse failure gives `NONE/CONFIG_INVALID`.
7. Preflight active version with `readDriveTermsImageFile`, `validateLineTermsImageBytes`, exact MIME match, and exact byte-length match. Any failure gives `NONE/ASSET_UNAVAILABLE`; success gives active public token.

Implement those rules in one helper, keeping provider details out of its result:

```ts
async function resolveTermsDecision({
  payment,
  legacySchedule,
  loadState,
  readFile,
}: {
  payment: PaymentRecord;
  legacySchedule?: ScheduleRecord;
  loadState: () => Promise<LineTermsImageState>;
  readFile: typeof readDriveTermsImageFile;
}): Promise<TermsDecision> {
  const position = resolveLineTermsPlanPosition(payment, legacySchedule);
  if (payment.line_retry_key) {
    if (!payment.line_terms_image_token) return { frozenToken: "NONE", skipReason: "" };
    if (payment.line_terms_image_token === "NONE") return { frozenToken: "NONE", skipReason: "" };
    return isLineTermsPublicToken(payment.line_terms_image_token)
      ? { frozenToken: payment.line_terms_image_token, skipReason: "" }
      : { frozenToken: "NONE", skipReason: "CONFIG_INVALID" };
  }
  if (position === "LATER") return { frozenToken: "NONE", skipReason: "" };
  if (position === "UNKNOWN") return { frozenToken: "NONE", skipReason: "POSITION_UNKNOWN" };
  let active: LineTermsImageVersion | null;
  try {
    active = activeLineTermsImageVersion(await loadState());
  } catch (error) {
    return { frozenToken: "NONE", skipReason: error instanceof LineTermsImageError ? "CONFIG_INVALID" : "ASSET_UNAVAILABLE" };
  }
  if (!active) return { frozenToken: "NONE", skipReason: "NOT_CONFIGURED" };
  try {
    const file = await readFile(active.driveFileId);
    const detected = validateLineTermsImageBytes(file.bytes);
    if (detected !== active.mimeType || file.bytes.byteLength !== active.byteLength) throw new Error("asset mismatch");
    return { frozenToken: active.publicToken, skipReason: "" };
  } catch {
    return { frozenToken: "NONE", skipReason: "ASSET_UNAVAILABLE" };
  }
}
```

Cache the state promise for a run, as existing message profiles are cached. Do not cache preflight failure across different files unless the active version is identical.

At sender scope, provide the helper a cached loader:

```ts
let termsStatePromise: Promise<LineTermsImageState> | null = null;
const loadTermsState = () => termsStatePromise ??= dependencies.getLineTermsImageState();
```

- [ ] **Step 5: Persist selection, audit degradation, and build message array**

When writing `SENDING`, persist:

```ts
line_terms_image_token: termsDecision.frozenToken,
```

For any non-empty `skipReason`, attempt one audit before LINE send. The decision is persisted as `NONE`, so a later retry does not repeat the warning:

```ts
await dependencies.appendAudit({
  paymentId: payment.payment_id,
  clientId: payment.client_id,
  action: "LINE_TERMS_IMAGE_SKIPPED",
  previousStatus,
  newStatus: "SENDING",
  reason: "LINE T&S image omitted; payment request continued",
  source: "LINE_DUE_SENDER",
  metadata: JSON.stringify({ paymentId: payment.payment_id, reasonCode: termsDecision.skipReason }),
}).catch(() => undefined);
```

Build messages without mutating shared arrays:

```ts
const messages: Array<{ type: string; [key: string]: unknown }> = [
  { type: "text", text: lineMessage },
  { type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl },
];
if (termsDecision.frozenToken !== "NONE") {
  const url = termsImageUrl(options.baseUrl, termsDecision.frozenToken);
  messages.push({ type: "image", originalContentUrl: url, previewImageUrl: url });
}
```

Pass `messages` to existing `sendPush`. Do not write skip reason into `line_message_error`; accepted audit reconciliation owns that field.

- [ ] **Step 6: Run sender tests and adjacent LINE tests**

Run: `npm test -- src/lib/line/due-payments.test.ts src/lib/line/client.test.ts src/lib/line/message-values.test.ts src/app/api/cron/generate/route.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 6 if its paths were clean at execution baseline**

```bash
git add src/lib/line/due-payments.ts src/lib/line/due-payments.test.ts
git commit -m "feat: send terms image on first plan payment"
```

If either sender path was dirty at baseline, skip this entire task commit.

---

### Task 7: Documentation and Full Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: completed Settings, Drive, public-route, schema, and sender behavior.
- Produces: operator guidance and verified repository state.

- [ ] **Step 1: Update operator documentation**

Add concise README guidance near LINE setup/operation:

```md
- In Settings, upload one JPEG or PNG T&S image (maximum 1 MiB). The app stores immutable versions in the already connected Google Drive folder.
- The first payment request for every new plan, including an extension, sends payment text, PromptPay QR, and the active T&S image. Later installments send text and QR only.
- Replacing the image affects future first attempts. Retries keep their frozen version. Missing or unavailable T&S media never blocks payment delivery.
```

State that tokenized T&S content is client-facing; private payment slips remain admin-only. Document no new environment variables.

- [ ] **Step 2: Run all focused feature tests together**

Run:

```bash
npm test -- \
  src/lib/line/terms-image.test.ts \
  src/lib/line/terms-image-upload.test.ts \
  src/lib/storage/drive-client.test.ts \
  src/lib/sheets/settings.test.ts \
  src/app/admin/'(protected)'/settings/terms-image-actions.test.ts \
  src/components/admin/line-terms-image-form.test.tsx \
  src/app/api/line/terms-image/'[publicToken]'/route.test.ts \
  src/lib/sheets/records.test.ts \
  src/lib/sheets/migration.test.ts \
  src/lib/sheets/payments.test.ts \
  src/lib/sheets/payment-client-snapshot.test.ts \
  src/lib/payments/generate.test.ts \
  src/lib/line/due-payments.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run repository quality gates**

Run: `npm run lint`

Expected: exit 0.

Run: `npm test`

Expected: all Vitest suites PASS with no live vendor calls.

Run: `npm run build`

Expected: production Next.js build completes, including strict TypeScript checks and new dynamic image route.

- [ ] **Step 4: Inspect final diff and security invariants**

Run: `git diff --check`

Expected: no whitespace errors.

Run:

```bash
rg -n "line_terms_image|LINE_TERMS_IMAGE|terms-image" src README.md
```

Confirm manually from output:

- only the registered-token route is public;
- public route never imports `requireAdmin` or accepts a Drive file ID parameter;
- private slip route remains authenticated;
- audit metadata excludes public token and Drive file ID;
- every `Payments!A:` range ends at `AX`;
- no task absorbed pre-existing unrelated worktree changes.

- [ ] **Step 5: Commit documentation if its path was clean at execution baseline**

```bash
git add README.md
git commit -m "docs: explain LINE terms image delivery"
```

If README was dirty at baseline, skip this commit and leave its edit unstaged.

- [ ] **Step 6: Use verification-before-completion before reporting success**

Invoke `superpowers:verification-before-completion`. Report exact test, lint, and build commands plus results. Mention any task commits skipped because of baseline dirty paths. Do not claim production delivery until local evidence passes.
