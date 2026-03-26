# UX User Flow Spec

## Scope

This document defines the end-to-end user journey and interaction contracts for:

1. `Projects`
2. `Units`
3. `Maintenance Letters`
4. `Payments & Receipts`
5. `Reports`

Routes:

1. `/projects`
2. `/units`
3. `/billing`
4. `/payments`
5. `/reports`

---

## Canonical Naming (UI Vocabulary)

Use these labels consistently across all screens and messages:

1. `Maintenance Letters` (not "Billing" in user-facing labels)
2. `Payments & Receipts` (page and navigation context)
3. `Record Payment`
4. `Record Bulk Payments`
5. `Generate Maintenance Letters`
6. `Financial Year` (`FY` only where space is constrained in tables/chips)
7. `Add-ons` (hyphenated consistently)

---

## Primary User Personas

1. Admin (full data setup + financial operations)
2. Operator (daily payment/receipt operations)

---

## Journey Map (Macro Flow)

1. Create/select project -> `/projects`
2. Add/import units -> `/units`
3. Generate yearly demand letters -> `/billing`
4. Record collections and produce receipts -> `/payments`
5. Audit collection/outstanding -> `/reports`

---

## Screen Contracts

### 1) Projects (`/projects`)

#### Entry Criteria

1. User is authenticated in app shell.
2. Database is available.

#### Primary Tasks

1. Add project manually.
2. Edit project details and banking metadata.
3. Configure sector-wise payment bank + QR settings (e.g. Sector A/B/C).
4. Open rates modal for project.
5. Filter/search projects.

#### Micro Touchpoints

1. Header actions: `Add Project`, `Delete Selected`.
2. Inline filters: search, status, city.
3. Filter chips with per-chip clear and `Clear all`.
4. Row actions: `Edit`, `Delete`, `Rates`.
5. Form tabs: `Basic Information`, `Bank Details`, `Sector Payment QR`.

#### Validation & Error States

1. Required: project name.
2. Toasts for fetch/create/update/delete failures.
3. Empty-state list should not block `Add Project`.

#### Exit Criteria

1. User has at least one active project to continue.

#### Acceptance Checks

1. Creating project persists and appears immediately in table.
2. Rates action opens the correct project context.
3. Sector payment config is saved per project and retrievable on edit.
4. Filter chips always mirror active filters.

---

### 2) Units (`/units`)

#### Entry Criteria

1. At least one project exists.

#### Primary Tasks

1. Add/edit/delete units.
2. Import units + ledger history via Excel.
3. Jump directly to letters or payments from row actions.

#### Micro Touchpoints

1. Header actions: `Import Excel`, `Add Unit`.
2. Bulk actions: `Generate Maintenance Letters`, `Delete`.
3. Row actions: `Generate Maintenance Letter`, `Record Payment`.
4. Import modal Step 1: project mapping + options.
5. Import modal Step 2: editable preview table + additional source columns.

#### Validation & Error States

1. Missing project in import -> error.
2. Missing unit/owner in preview -> red required indicators.
3. Invalid area range checks (min/max guardrails).

#### Data Mapping Rules (Import)

1. For sector-based ledgers, `unit_number = Sector-Plot` fallback.
2. Duplicate headers preserved (`GST`, `GST_1`...).
3. Year columns (`YYYY-YY`) parsed as base amount.
4. Year-adjacent columns like GST/Pipe Replacement mapped into add-ons.

#### Exit Criteria

1. Units are created/updated with owner/contact/email and yearly data ready for letters.

#### Acceptance Checks

1. Re-import of same sheet does not fail on `(unit_id, financial_year)` conflict.
2. Contact and email columns remain visible in preview.
3. Imported rows count equals preview rows imported (excluding intentionally skipped empty rows).

---

### 3) Maintenance Letters (`/billing`, user label: `Maintenance Letters`)

#### Entry Criteria

1. Project exists.
2. Units exist for selected project.
3. Maintenance rate exists for selected FY.

#### Primary Tasks

1. Generate letters for all or selected units.
2. View/filter letters by project/FY/status/type.
3. Open PDF generation.
4. Navigate to payment recording for a letter/unit.

#### Micro Touchpoints

1. Header action: `Generate Maintenance Letters`.
2. Modal flow:
   1. Step 1 config: project, FY, dates, add-ons.
   2. Step 2 optional unit picker.
3. Post-generation info notification: "record payments next".
4. Table status tags: `Pending`, `Paid`, `Overdue`.
5. Row actions: `Record Payment`, `PDF`, `Edit`, `Delete`.

#### Validation & Error States

1. Missing rate for FY -> modal with `Open Rates` path.
2. Required date/FY/project validation before generation.

#### Business Rule

1. Letter generation does not create payments.
2. Freshly generated letters default to `Pending` until payments are recorded.

#### Exit Criteria

1. Letters generated and visible.
2. User can transition to `/payments` with unit context.

#### Acceptance Checks

1. After generation, letter appears in list with selected FY and due date.
2. `Record Payment` button opens payments flow with the same unit context.
3. Status display matches payment reconciliation (`Paid` only when paid >= final amount).

---

### 4) Payments & Receipts (`/payments`)

#### Entry Criteria

1. At least one unit exists.
2. Usually at least one maintenance letter exists for target FY.

#### Primary Tasks

1. Record single payment.
2. Record bulk payments.
3. Generate one or many receipt PDFs.
4. Filter/search payment history.

#### Micro Touchpoints

1. Header actions: `Record Payment`, `Record Bulk Payments`, `Batch Receipts`.
2. Single record modal:
   1. Select unit.
   2. Optional letter selection auto-fills FY + amount.
   3. Enter date, amount, mode, reference, remarks.
3. Bulk modal:
   1. Select project + FY + date.
   2. Optional helper actions (set same amount, calculate from letters, mode shortcuts).
4. Table columns include `Receipt #`.
5. Row action `Receipt` generates and opens folder.

#### Validation & Error States

1. Overpayment confirmation dialog before submit.
2. Required amount/date/mode/FY validations.
3. Receipt generation progress and partial-failure feedback.

#### Business Rules

1. Recording payment updates corresponding letter status.
2. Receipt row is created on payment save; PDF is generated on explicit receipt action (or bulk auto-step).
3. FY filter can hide records if default FY does not match payment FY.

#### Exit Criteria

1. Payment appears in table.
2. Linked letter status updates (`Pending` -> `Paid` when threshold met).
3. Receipt number visible; receipt PDF can be generated/opened.

#### Acceptance Checks

1. Single payment against selected letter updates status in Maintenance Letters view.
2. `Receipt #` column shows value once payment is recorded.
3. Batch receipts complete with success/fail counters.

---

### 5) Reports (`/reports`)

#### Entry Criteria

1. Letters/payments exist.

#### Primary Tasks

1. View billed vs paid vs balance.
2. Slice by project/FY/status.
3. Export report.

#### Micro Touchpoints

1. Filter controls and summary cards.
2. Table aggregations and export actions.

#### Exit Criteria

1. User can audit collections and outstanding balances for decision-making.

#### Acceptance Checks

1. Totals reconcile with letters/payments tables.
2. Export reflects current filters.

---

## Cross-Screen Transition Contracts

1. `/units` -> `/billing`:
   1. Via row/bulk action with selected unit IDs in route state.
2. `/units` -> `/payments`:
   1. Via row action with single unit context.
3. `/billing` -> `/payments`:
   1. Via `Record Payment` action per letter/unit.
4. `/projects` -> rate management:
   1. `Open Rates` deep-link path from missing-rate errors.

Acceptance:

1. Contextual transitions pre-fill target screen when possible.
2. Route state is cleared after handling to prevent duplicate re-triggers.

---

## Status Logic Contract (Critical)

A maintenance letter is:

1. `Paid` when total matched payment amount `+ 0.01 >= final_amount`.
2. `Pending` otherwise.

Matching logic includes:

1. Payments linked by `letter_id`.
2. Legacy/unlinked payments (`letter_id IS NULL`) matched by `unit_id + financial_year`.

Acceptance:

1. Existing historical data and new data both reconcile correctly.
2. Re-fetching maintenance letters reflects corrected statuses.

---

## Known UX Risks / Follow-ups

1. Projects import button is currently rendered disabled in UI.
2. Default FY filters in Payments can hide valid historical records.
3. Copy style still mixes `FY` and `Financial Year` in some compact contexts (acceptable but should stay intentional).

---

## Regression Checklist

1. Create project -> appears in Projects table.
2. Add unit manually -> appears in Units table.
3. Import ledger -> no duplicate-key crash; unit-year rows upsert correctly.
4. Generate maintenance letters -> letters visible with `Pending`.
5. Record payment against letter -> status flips to `Paid` when eligible.
6. Generate receipt -> receipt file opens folder and `Receipt #` visible.
7. Filters/chips/clear actions behave consistently across pages.
