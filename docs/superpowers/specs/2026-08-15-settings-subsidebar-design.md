# Settings Sub-Sidebar Design

## Goal

Replace the single long Settings page with focused, deep-linkable settings pages and a shared settings sub-sidebar. Preserve all existing settings behavior, validation, authorization, and server actions.

## Routes

`/admin/settings` redirects to `/admin/settings/business`.

The protected settings route group contains these pages:

| Route | Navigation label | Content |
| --- | --- | --- |
| `/admin/settings/business` | Business & payments | Runtime configuration and PromptPay settings |
| `/admin/settings/workspace` | Workspace | Workbook links, workspace connection test, and Google Drive connection |
| `/admin/settings/line` | LINE channel | LINE credentials and validation status |
| `/admin/settings/messages` | Messages | Welcome-message and due-payment message templates |
| `/admin/settings/payment-delivery` | Payment delivery | LINE terms-and-conditions image |

The old settings URL remains a safe entry point through its redirect. Google OAuth return paths and server action revalidation continue targeting `/admin/settings`; Next.js refreshes the active nested route through the shared layout.

## UI

Use a server-rendered shared settings layout.

- Desktop: a sticky, vertical shadcn Sidebar navigation beside the current page content.
- Mobile: a compact navigation control opening the same links in a shadcn Sheet.
- Active item derives from the current pathname and has an accessible current-page indicator.
- The layout owns Settings heading and description. Each child page owns its relevant cards and form controls.
- Use existing shadcn `Sidebar`, `Sheet`, `Separator`, `Card`, and semantic Tailwind tokens. No new component registry dependency or global style change is needed.

## Data and actions

Each child page fetches only data required by its cards. Existing server actions, secret handling, validation, audit records, and form components are reused without API changes.

Actions keep their existing `revalidatePath("/admin/settings")` calls. The shared settings layout and current page render after the action or redirect as they do today.

## Errors and navigation

- Workspace connection query states (`workspace`, `drive_error`) remain on the Workspace page.
- The Google Drive OAuth callback and connect route redirect to `/admin/settings/workspace`, preserving reconnect intent and error query parameters.
- A missing or malformed terms-image configuration remains a contained Payment delivery page error.
- Empty/missing workspace and LINE configuration retain their current safe UI states.

## Testing

- Add route/layout tests asserting the redirect and section-to-form mapping.
- Test active navigation state and mobile navigation accessibility in an isolated client navigation component.
- Update existing settings page tests to target the route that owns due-message profiles.
- Preserve all current action and form tests.

## Non-goals

- No setting keys, persistence format, server action API, permissions policy, or secret storage changes.
- No visual redesign of the forms themselves.
