# Client-form chrome cleanup

## Goal

Make the new-client page more direct by removing non-functional headings and status copy, while retaining all form controls and scheduling behavior.

## UI changes

- Remove the `Client plan` card title and its explanatory description.
- Remove the `Client details` fieldset legend.
- Keep `Payment plan` as the remaining form grouping.
- Remove `Admin workspace` from the protected-area header; retain the sidebar trigger and layout.
- Remove the Google Sheets connection and Admin session status copy from the sidebar footer; retain Sign out.
- Show selected payment types in natural language: `One-time payment` for `ONE_TIME`, and `Installments` for `INSTALLMENTS`.

## Boundaries

- No change to field names, submitted values, validation, package-prefill behavior, schedule generation, summary calculations, or navigation.
- Keep the client form card and plan-summary card so spacing and responsive layout remain stable.

## Testing

- Add component coverage that asserts internal payment values render with natural-language labels.
- Keep existing form-submission coverage, proving `ONE_TIME` still submits its required internal values.
- Run the focused component test, full test suite, lint, and production build.
