# Settings Sub-Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single long Settings page with deep-linkable pages sharing accessible responsive sub-sidebar.

**Architecture:** Client `SettingsNavigation` owns active desktop/mobile navigation. Server layout supplies page frame. Server pages load only section data and reuse cards/actions. Root Settings redirects to Business; Drive callbacks go to Workspace.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind v4, shadcn Sidebar/Sheet/Card/Separator, Vitest, Testing Library.

## Global Constraints

- Preserve setting keys, persistence, server action APIs, permissions, secret storage, validation, audits, form behavior.
- Existing shadcn components + semantic tokens only. No package, registry, global CSS change.
- `/admin/settings` redirects to `/admin/settings/business`.
- `workspace` and `drive_error` stay on Workspace.
- TDD: observe failing test before production implementation.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/components/admin/settings-navigation.tsx` | Client desktop Sidebar/mobile Sheet navigation. |
| `src/components/admin/settings-navigation.test.tsx` | Active link/mobile menu tests. |
| `src/app/admin/(protected)/settings/layout.tsx` | Shared heading/navigation/content frame. |
| `src/app/admin/(protected)/settings/page.tsx` | Legacy redirect. |
| `src/app/admin/(protected)/settings/{business,workspace,line,messages,payment-delivery}/page.tsx` | Focused server pages. |
| `src/app/admin/(protected)/settings/**/*.test.tsx` | Route data/prop safety tests. |
| `src/app/admin/google-drive/{connect,callback}/route.ts` | Workspace callback destinations. |

### Task 1: Settings navigation

**Files:**
- Create: `src/components/admin/settings-navigation.tsx`
- Create: `src/components/admin/settings-navigation.test.tsx`

**Interfaces:** Consumes `usePathname`, Next `Link`, Sidebar/Sheet primitives. Produces `SettingsNavigation(): React.ReactElement`.

- [ ] **Step 1: Write failing tests**

```tsx
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/settings/messages" }));

it("marks Messages current and exposes section routes", () => {
  render(<SettingsNavigation />);
  expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Business & payments" })).toHaveAttribute("href", "/admin/settings/business");
  expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/admin/settings/workspace");
  expect(screen.getByRole("link", { name: "LINE channel" })).toHaveAttribute("href", "/admin/settings/line");
  expect(screen.getByRole("link", { name: "Payment delivery" })).toHaveAttribute("href", "/admin/settings/payment-delivery");
});

it("opens accessible mobile navigation", () => {
  render(<SettingsNavigation />);
  fireEvent.click(screen.getByRole("button", { name: "Open settings navigation" }));
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Settings navigation");
});
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/components/admin/settings-navigation.test.tsx`

Expected: FAIL; module absent.

- [ ] **Step 3: Implement minimum navigation**

```tsx
"use client";
const settingsSections = [
  { href: "/admin/settings/business", label: "Business & payments", icon: Building2Icon },
  { href: "/admin/settings/workspace", label: "Workspace", icon: DatabaseIcon },
  { href: "/admin/settings/line", label: "LINE channel", icon: MessageCircleIcon },
  { href: "/admin/settings/messages", label: "Messages", icon: ScrollTextIcon },
  { href: "/admin/settings/payment-delivery", label: "Payment delivery", icon: ImageIcon },
] as const;
```

Render Sidebar links via `SidebarMenuButton render={<Link href={section.href} />}`, set `isActive`/`aria-current` on exact pathname match. Desktop wrapper is `hidden lg:block sticky top-6`; mobile trigger is `lg:hidden`, opens Sheet titled `Settings navigation`, contains same links, and closes after link activation.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/components/admin/settings-navigation.test.tsx`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/settings-navigation.tsx src/components/admin/settings-navigation.test.tsx && git commit -m "feat: add settings sub-navigation"
```

### Task 2: Shared layout and legacy redirect

**Files:**
- Create: `src/app/admin/(protected)/settings/layout.tsx`
- Create: `src/app/admin/(protected)/settings/layout.test.tsx`
- Modify: `src/app/admin/(protected)/settings/page.tsx`
- Modify: `src/app/admin/(protected)/settings/page.test.tsx`

**Interfaces:** Consumes `SettingsNavigation`, `PageHeader`, `Separator`, `redirect`. Produces shared Settings frame and root redirect.

- [ ] **Step 1: Write failing tests**

```tsx
it("redirects legacy Settings URL to Business", async () => {
  await SettingsPage();
  expect(mocks.redirect).toHaveBeenCalledWith("/admin/settings/business");
});

it("renders child content beside settings navigation", () => {
  render(<SettingsLayout><p>Business content</p></SettingsLayout>);
  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(screen.getByText("Business content")).toBeTruthy();
});
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/app/admin/(protected)/settings/page.test.tsx src/app/admin/(protected)/settings/layout.test.tsx`

Expected: FAIL; current root page renders settings cards.

- [ ] **Step 3: Implement**

```tsx
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6">
    <PageHeader title="Settings" description="Business settings live in your workbook. Google and LINE secrets stay encrypted in the private key safe." />
    <Separator />
    <div className="flex flex-col gap-6 lg:flex-row"><SettingsNavigation /><div className="min-w-0 flex-1">{children}</div></div>
  </div>;
}

export default function SettingsPage() { redirect("/admin/settings/business"); }
```

No route-level wrapper Card: child forms own their existing Cards.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/app/admin/(protected)/settings/page.test.tsx src/app/admin/(protected)/settings/layout.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/(protected)/settings/layout.tsx src/app/admin/(protected)/settings/layout.test.tsx src/app/admin/(protected)/settings/page.tsx src/app/admin/(protected)/settings/page.test.tsx && git commit -m "feat: add settings route layout"
```

### Task 3: Core settings routes

**Files:**
- Create: `src/app/admin/(protected)/settings/business/page.tsx`
- Create: `src/app/admin/(protected)/settings/workspace/page.tsx`
- Create: `src/app/admin/(protected)/settings/line/page.tsx`
- Create: `src/app/admin/(protected)/settings/workspace/page.test.tsx`
- Create: `src/app/admin/(protected)/settings/line/page.test.tsx`

**Interfaces:** Consumes current runtime/workspace/Drive/secret services and existing actions. Produces focused server pages with unchanged component props.

- [ ] **Step 1: Write failing boundary tests**

```tsx
it("passes reconnect state and Drive error to Workspace", async () => {
  render(await WorkspaceSettingsPage({ searchParams: Promise.resolve({ workspace: "reconnect_pending", drive_error: "oauth_denied" }) }));
  expect(mocks.driveCard).toHaveBeenCalledWith(expect.objectContaining({ autoOpenPicker: true, initialError: "Google Drive authorization was canceled." }));
});

it("passes encrypted metadata and validation to LINE channel", async () => {
  render(await LineSettingsPage());
  expect(mocks.lineForm).toHaveBeenCalledWith(expect.objectContaining({ validation: { status: "VALID", validatedAt: "2026-08-15T00:00:00.000Z" } }));
});
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/app/admin/(protected)/settings/workspace/page.test.tsx src/app/admin/(protected)/settings/line/page.test.tsx`

Expected: FAIL; focused pages absent.

- [ ] **Step 3: Implement**

Business calls `runtimeConfig()` and `getSecretMetadata()`, then renders existing RuntimeConfig Card/Form with `saveRuntimeConfigAction` and `allowLineFeatures={credentials.every((credential) => credential.configured)}`. Workspace moves workbook links, test form, Drive card, `activateGoogleDriveFolderAction`, exact `driveErrorMessage` mapping. LINE moves secret read, validation setting parse, `lineCredentialMetadata`, `validationMetadata`, and existing `LineIntegrationForm`/action.

```tsx
const [settings, secretMetadata] = await Promise.all([listOperationalSettings(), getSecretMetadata()]);
const validation = validationMetadata(settings.find((item) => item.key === "line_access_token_validation")?.value);
return <LineIntegrationForm credentials={lineCredentialMetadata(secretMetadata)} validation={validation} action={saveAndTestLineCredentialsAction} />;
```

- [ ] **Step 4: Verify green**

Run: `npm test -- src/app/admin/(protected)/settings/workspace/page.test.tsx src/app/admin/(protected)/settings/line/page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/(protected)/settings/business src/app/admin/(protected)/settings/workspace src/app/admin/(protected)/settings/line && git commit -m "feat: split core settings pages"
```

### Task 4: Message and delivery routes

**Files:**
- Create: `src/app/admin/(protected)/settings/messages/page.tsx`
- Create: `src/app/admin/(protected)/settings/messages/page.test.tsx`
- Create: `src/app/admin/(protected)/settings/payment-delivery/page.tsx`
- Create: `src/app/admin/(protected)/settings/payment-delivery/page.test.tsx`

**Interfaces:** Consumes existing template/image forms, parsers, connection services, actions. Produces focused server pages.

- [ ] **Step 1: Write failing safety tests**

```tsx
it("uses one Settings read and passes independent due profiles", async () => {
  render(await MessagesSettingsPage());
  expect(mocks.listOperationalSettings).toHaveBeenCalledOnce();
  expect(mocks.dueForm).toHaveBeenCalledWith(expect.objectContaining({ profiles: { ONE_TIME: { kind: "VALID", profile: DEFAULT_LINE_DUE_PROFILES.ONE_TIME }, INSTALLMENTS: { kind: "INVALID" } } }));
});

it("contains corrupt terms image state", async () => {
  render(await PaymentDeliverySettingsPage());
  expect(mocks.termsForm).toHaveBeenCalledWith(expect.objectContaining({ image: null, error: "T&S image configuration needs attention." }));
});
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/app/admin/(protected)/settings/messages/page.test.tsx src/app/admin/(protected)/settings/payment-delivery/page.test.tsx`

Expected: FAIL; focused pages absent.

- [ ] **Step 3: Implement**

Messages reads settings once, computes due profiles/welcome default, and renders current form/action props unchanged. Payment delivery reads settings plus connection and preserves image parse containment.

```tsx
let image: { previewUrl: string; uploadedAt: string } | null = null;
let error = "";
try {
  const active = activeLineTermsImageVersion(parseLineTermsImageState(settings));
  image = active ? { previewUrl: lineTermsImagePath(active.publicToken), uploadedAt: active.uploadedAt } : null;
} catch { error = "T&S image configuration needs attention."; }
```

- [ ] **Step 4: Verify green**

Run: `npm test -- src/app/admin/(protected)/settings/messages/page.test.tsx src/app/admin/(protected)/settings/payment-delivery/page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/(protected)/settings/messages src/app/admin/(protected)/settings/payment-delivery && git commit -m "feat: split messaging settings pages"
```

### Task 5: OAuth return route and final verification

**Files:**
- Modify: `src/app/admin/google-drive/connect/route.ts`
- Modify: `src/app/admin/google-drive/connect/route.test.ts`
- Modify: `src/app/admin/google-drive/callback/route.ts`
- Modify: `src/app/admin/google-drive/callback/route.test.ts`

**Interfaces:** Consumes OAuth intent/status. Produces Workspace settings returns preserving query names.

- [ ] **Step 1: Write failing redirect assertions**

```tsx
expect(response.headers.get("location")).toBe("https://app.example/admin/settings/workspace?workspace=reconnect_pending");
```

Keep login and setup routes unchanged.

- [ ] **Step 2: Verify red**

Run: `npm test -- src/app/admin/google-drive/connect/route.test.ts src/app/admin/google-drive/callback/route.test.ts`

Expected: FAIL; Settings returns still target root.

- [ ] **Step 3: Implement target changes**

```ts
const url = new URL(intent === "login" ? "/admin/login" : intent === "setup" ? "/admin/setup" : "/admin/settings/workspace", request.url);
const url = new URL(intent === "reconnect" || complete ? "/admin/settings/workspace" : error ? "/admin/login" : "/admin/setup", request.url);
```

Do not alter OAuth validation, error mapping, or query names.

- [ ] **Step 4: Verify green and full regression suite**

Run: `npm test -- src/components/admin/settings-navigation.test.tsx src/app/admin/(protected)/settings src/app/admin/google-drive/connect/route.test.ts src/app/admin/google-drive/callback/route.test.ts && npm run lint && npm test && npm run build`

Expected: all commands exit 0, zero lint/test failures, Next production build completes.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/google-drive/connect/route.ts src/app/admin/google-drive/connect/route.test.ts src/app/admin/google-drive/callback/route.ts src/app/admin/google-drive/callback/route.test.ts && git commit -m "fix: return drive setup to workspace settings"
```

## Self-Review

- Coverage: Tasks 1–2 deliver responsive navigation/root redirect; Tasks 3–4 map all five sections and current error behavior; Task 5 preserves OAuth and runs full quality gates.
- No incomplete implementation/test/error requirements. `SettingsNavigation` is sole shared client component; pages stay server components and retain existing action signatures.
