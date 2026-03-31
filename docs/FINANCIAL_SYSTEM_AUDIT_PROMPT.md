## Financial System Audit Prompt

You are my senior system auditor and financial data accuracy expert.

Audit the Barkat residential dashboard end-to-end for:
- calculation accuracy
- data mapping correctness
- integer-only financial values
- frontend to backend integration
- PDF accuracy
- section-wise functionality

Do NOT redesign.
Do NOT rewrite architecture unless required.
Only audit, verify, identify issues, and suggest minimal fixes.

### Context
This system handles residential maintenance billing, unit management, payments, reports, imports, and PDF generation.
Financial outputs must be integer-only. No decimal values are allowed in stored final amounts, API final amounts, UI totals, or PDF totals.

### Primary audit goal
Verify that the backend is the single source of truth and that the same input always produces the same final output across DB, API, UI, and PDF.

### Audit order

#### 1. System Entry Points
Identify every financial data source:
- Excel import fields
- manual entry fields
- project charges configuration
- maintenance rates
- add-ons
- penalties
- arrears
- discounts
- payments
- any extra charges

For each source, list:
- input field name
- expected type
- required or optional
- where it enters the system
- where it is stored

#### 2. Data Mapping Verification
Trace data flow for each major path:
- Excel to backend validation to DB
- Manual entry to backend validation to DB
- DB to backend calculation to API response
- API response to frontend display
- DB or final backend values to PDF generation

Verify:
- same field names and meaning across all layers
- no incorrect mapping
- no silent transformation
- no field reuse with different business meaning
- no frontend-only derived value being treated as final truth

Flag examples like:
- addon mapped as penalty
- discount mixed into base amount
- UI field name differs from DB or API meaning
- PDF reading a different source than UI

#### 3. Backend Validation Audit
Check all validation rules before data is stored:
- positive integer checks
- required fields
- date and financial year format
- duplicate prevention
- unit/project ownership validation
- invalid import row handling

Verify:
- validation happens in backend, not only frontend
- invalid data cannot silently enter DB
- financial fields reject decimals if business rule is integer-only

#### 4. Calculation Engine Audit
Check every financial formula used in backend:
- base maintenance
- GST or tax
- add-ons
- penalties
- arrears
- discounts
- final amount
- payment outstanding or balance
- report totals

Verify:
- formulas are consistent everywhere
- no duplicate additions
- no missing components
- no frontend-only final calculation
- no PDF-side recalculation that can drift from backend logic

For each formula, identify:
- file and function
- formula used
- expected formula
- mismatch if any

#### 5. Rounding and Integer Rule Audit
This is critical.

Verify:
- whether decimals are generated anywhere
- whether rounding happens before save, before response, before display, or only in PDF
- whether all financial outputs are whole integers
- whether one shared rounding rule exists

Expected rule:
- final money values must be integers only
- backend must normalize before persistence or before returning final values
- UI and PDF must use normalized final values only

Explicitly identify:
- where decimals are introduced
- where decimals are stored
- where decimals are displayed
- where decimals are printed in PDF

#### 6. PDF Accuracy Audit
Break PDF verification into sections:
- header and project details
- resident and unit details
- amount breakdown
- add-ons
- penalties
- arrears
- discounts
- total
- payment receipt details

Verify:
- every section uses the correct backend or DB field
- PDF does not recompute business logic differently
- PDF totals exactly match backend final values
- PDF formatting follows integer-only rule

#### 7. Frontend to Backend Integration Audit
Verify:
- frontend sends raw input only
- backend validates and computes
- API returns validated and final values
- frontend displays final values only
- frontend does not override final backend values
- reports do not become a second calculation engine unless intentionally designed

#### 8. Data Consistency and Repeatability
Check:
- same input always gives same output
- updates trigger correct recalculation where required
- no stale cache issue
- no mismatch between DB values, API values, UI values, and PDF values

#### 9. Edge Cases
Audit behavior for:
- invalid Excel structure
- missing fields
- duplicate unit or flat entries
- duplicate letters
- duplicate payments
- negative numbers
- zero values
- large imports
- partially paid letters
- deleted add-ons
- changed rates after generation

### Required output format

#### A. Executive Summary
- overall audit status
- whether system is financially reliable or not
- top 3 risks

#### B. Issues Table
Use this format:

| Severity | Area | Exact Location | Issue | Why It’s Wrong | Minimal Fix |
| --- | --- | --- | --- | --- | --- |

#### C. Data Flow Validation
Show:
- current actual flow
- corrected flow

#### D. Financial Accuracy Verdict
State clearly:
- whether calculations are backend-controlled
- whether integer-only rule is enforced
- whether PDF matches backend truth

#### E. Priority Fix Order
List:
1. release blockers
2. medium-priority fixes
3. later cleanup

### Strict audit rules
- Assume bugs exist until verified otherwise
- Never trust frontend as financial source of truth
- Backend must be the final authority
- PDF must match backend final values exactly
- No decimals allowed in final monetary outputs
- If a formula differs by layer, treat it as a defect
- Prefer minimal-change fixes over redesign
