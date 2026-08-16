# Messages Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Settings → Messages a focused editor workspace instead of one long stack of unrelated textareas.

**Architecture:** `MessagesSettingsWorkspace` owns a four-category message navigator and shows one existing editor at a time. `LineAutomaticReplyForm` gets a second tab layer for payment-slip and LINE-connection replies. Existing server settings resolution and action contracts stay unchanged.

**Tech Stack:** Next.js App Router, React client components, installed Base UI Shadcn Tabs, Vitest, Testing Library.

## Global Constraints

- Preserve all template, preview, save, reset, validation, and audit behavior.
- Use installed Shadcn Tabs; add no dependencies.
- Use horizontal scrolling category tabs on small viewports and a compact rail on desktop.
- Use existing semantic colors, Lucide icons, Field components, and Button variants.
- Write regression tests first; run lint, all tests, and build before commit.

---

### Task 1: Add category workspace

**Files:**
- Create: `src/components/admin/messages-settings-workspace.tsx`
- Test: `src/components/admin/messages-settings-workspace.test.tsx`

**Interfaces:**
- Consumes: `welcome`, `automaticReplies`, `paymentMessages`, `reminders` as `ReactNode` slots.
- Produces: `MessagesSettingsWorkspace` with one selected panel.

- [ ] Write failing test.

```tsx
render(<MessagesSettingsWorkspace welcome={<p>Welcome editor</p>} automaticReplies={<p>Replies editor</p>} paymentMessages={<p>Payment editor</p>} reminders={<p>Reminder editor</p>} />);
expect(screen.getByText("Welcome editor")).toBeInTheDocument();
expect(screen.queryByText("Payment editor")).not.toBeInTheDocument();
fireEvent.click(screen.getByRole("tab", { name: "Payment messages" }));
expect(screen.getByText("Payment editor")).toBeInTheDocument();
```

- [ ] Run `npm test -- src/components/admin/messages-settings-workspace.test.tsx`; expect module-not-found failure.
- [ ] Implement a `Tabs` category navigator with Welcome message, Automatic replies, Payment messages, and Installment reminders.
- [ ] Re-run focused test; expect pass.
- [ ] Commit: `git add src/components/admin/messages-settings-workspace.tsx src/components/admin/messages-settings-workspace.test.tsx && git commit -m "feat: organize message settings editors"`.

### Task 2: Mount message editors in one workspace

**Files:**
- Modify: `src/app/admin/(protected)/settings/messages/page.tsx`
- Modify: `src/app/admin/(protected)/settings/messages/page.test.tsx`

**Interfaces:**
- Consumes: current four editor components, resolved settings, server actions.
- Produces: same data and actions, passed as named workspace slots.

- [ ] Write failing page test that asserts the category tab exists and mocks receive unchanged props.
- [ ] Run `npm test -- 'src/app/admin/(protected)/settings/messages/page.test.tsx'`; expect missing navigator failure.
- [ ] Replace vertical stack with `MessagesSettingsWorkspace`, preserving all exact action props.
- [ ] Re-run focused page test; expect pass.
- [ ] Commit: `git add 'src/app/admin/(protected)/settings/messages/page.tsx' 'src/app/admin/(protected)/settings/messages/page.test.tsx' && git commit -m "feat: add message settings navigation"`.

### Task 3: Split automatic replies into two editable groups

**Files:**
- Modify: `src/components/admin/line-automatic-reply-form.tsx`
- Modify: `src/components/admin/line-automatic-reply-form.test.tsx`

**Interfaces:**
- Consumes: existing `LineAutomaticReplyConfig` and save/reset actions.
- Produces: Payment slip replies and LINE connection replies as distinct tabs; save submits full draft config.

- [ ] Write failing test that starts on Payment slip replies, hides connection fields, then reveals them after choosing LINE connection replies.
- [ ] Run `npm test -- src/components/admin/line-automatic-reply-form.test.tsx`; expect both groups currently visible failure.
- [ ] Put current reply `FieldGroup`s into Shadcn `TabsContent` panels; retain shared save/reset controls.
- [ ] Re-run focused test; expect pass and existing complete-save assertions pass.
- [ ] Commit: `git add src/components/admin/line-automatic-reply-form.tsx src/components/admin/line-automatic-reply-form.test.tsx && git commit -m "feat: compact automatic reply editing"`.

### Task 4: Visual and production verification

**Files:**
- Modify: no source expected.

- [ ] Use Browser for Welcome, automatic reply category/group switch, due-payment profile tabs, reminder editor dialog, and mobile-width layout.
- [ ] Compare browser screenshots to Image Gen concepts: category rail, one editor panel, textarea density, actions, typography, and spacing.
- [ ] Run `npm run lint`, `npm test`, and `npm run build`; inspect exit codes.
- [ ] Commit and push all source, test, and this plan: `git add src/components/admin/messages-settings-workspace.tsx src/components/admin/messages-settings-workspace.test.tsx 'src/app/admin/(protected)/settings/messages/page.tsx' 'src/app/admin/(protected)/settings/messages/page.test.tsx' src/components/admin/line-automatic-reply-form.tsx src/components/admin/line-automatic-reply-form.test.tsx docs/superpowers/plans/2026-08-16-messages-settings-redesign.md && git commit -m "feat: streamline message settings" && git push`.
