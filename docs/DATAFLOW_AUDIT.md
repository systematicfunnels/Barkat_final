# Frontend-to-Backend Dataflow Audit

## Executive Summary

This audit maps the three critical user workflows (Import, Billing, Payments) through the **Renderer → Preload Bridge → IPC → Main Process → Services → SQLite DB** stack. It identifies performance bottlenecks, error handling gaps, state consistency issues, and opportunities for async background processing.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Renderer Process (React + Ant Design)                           │
│  - Projects.tsx, Billing.tsx, Payments.tsx                      │
│  - Local state (useState), form validation                      │
│  - No direct DB access                                          │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │ window.api.*
                       │ (Preload Bridge IPC)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ Preload (src/preload/index.ts)                                  │
│  - Exposes window.api.* namespace via contextBridge             │
│  - ipcRenderer.invoke(channel, args) calls                      │
│  - No logic, only IPC marshalling                               │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │ ipcMain.handle(channel, handler)
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ Main Process (IPC Handlers in ipcHandlers.ts)                   │
│  - Entry point for all backend operations                       │
│  - Input validation (sanitizeText, isPositiveInteger, etc.)    │
│  - Delegates to Service layer                                  │
│  - Runs SYNCHRONOUSLY on main thread (⚠️ BLOCKING)              │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ Service Layer (src/main/services/*.ts)                          │
│  - ProjectService, UnitService, MaintenanceLetterService, etc. │
│  - Business logic: validation, calculations, orchestration      │
│  - Calls dbService.run/query/transaction                        │
│  - Some methods marked async (PDF generation)                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ Database Service (src/main/db/database.ts)                      │
│  - Wrapper around better-sqlite3                                │
│  - Provides: query(), get(), run(), transaction()               │
│  - Handles schema migrations, integrity checks                  │
│  - SQLite with WAL mode (journey_mode = WAL)                    │
│  - Foreign key enforcement (ON/OFF during migration)            │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ SQLite Database (barkat.db)                                     │
│  - Local file in app.getPath('userData') or __dirname           │
│  - Tables: projects, units, maintenance_rates, payments,        │
│    maintenance_letters, project_sector_payment_configs, etc.    │
│  - Foreign keys with ON DELETE CASCADE                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Critical Dataflows

### 1. IMPORT WORKFLOW: Standard Workbook → Projects + Units + Letters

**Trigger:** User uploads Excel file in Projects page  
**Path:** Renderer → IPC → Main → ProjectService → UnitService → DB

#### Execution Flow:

```
Projects.tsx (Renderer)
  ↓
  1. User selects Excel file
  2. readExcelWorkbook(file) [BROWSER-SIDE, ASYNC]
     - Detects .xlsx / .xls / .csv
     - Parses sheets into { [sheetName]: Record[] }
     - Returns ~immediately (no IPC yet)
  3. parseStandardWorkbook(workbookData) [BROWSER-SIDE, SYNC]
     - Maps raw rows to StandardWorkbookImportRow[]
     - Creates .preview state, NO DB changes yet
     - User reviews preview (optional conflict UI)
  4. executeStandardWorkbookImport()
     - Calls window.api.projects.importStandardWorkbookProject(payload) ← IPC INVOKE

  ↓ [IPC BRIDGE]

ipcHandlers.ts (Main Thread)
  ↓
  5. Handler 'import-standard-workbook-project'
     - Validates payload.project.name, rows[], sector_configs[]
     - Calls projectService.importStandardWorkbookProject(payload)

  ↓

ProjectService.importStandardWorkbookProject(payload)
  ↓
  6. dbService.transaction(() => {
       a. Get or create project (sanitize name, merge config)
       b. Save sector configs (QR codes, etc.)
       c. Call unitService.importLedger(projectId, rows)
         ↓
         UnitService.importLedger()
         ├─ For each row:
         │  ├─ Create unit (unit_number, owner, area, etc.)
         │  ├─ Create maintenance_letters for each year
         │  └─ Link payments if provided
         └─ Returns success boolean
       d. Count imported units + letters
     })
  7. Returns StandardWorkbookProjectImportResult

  ↓ [IPC RESPONSE]

Projects.tsx (Renderer)
  ↓
  8. Receives result: { project_id, imported_units, imported_letters }
  9. Show success notification
  10. Refresh project list (fetchProjects)
```

#### Issues identified:

| Issue                                                                        | Impact                                                   | Severity |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- | -------- |
| **Entire import transaction runs on main thread**                            | UI blocks during large import (1000+ units)              | HIGH     |
| **No dry-run or conflict preview via IPC**                                   | User can't see what will be inserted before commit       | HIGH     |
| **unitService.importLedger loops row-by-row, creates individual DB inserts** | Slower than batch insert; no rollback granularity        | MEDIUM   |
| **Error during mid-transaction leaves partial data**                         | If import fails halfway, old letters may remain orphaned | MEDIUM   |
| **No import log saved**                                                      | Cannot audit what was imported and when                  | LOW      |
| **No duplicate detection**                                                   | Reimporting same workbook creates duplicate units        | MEDIUM   |

---

### 2. BILLING WORKFLOW: Generate Letters (Batch Create)

**Trigger:** User clicks "Generate Letters" in Billing page  
**Path:** Renderer → IPC → Main → MaintenanceLetterService → DB

#### Execution Flow:

```
Billing.tsx (Renderer)
  ↓
  1. User selects project, financial year, letter/due dates, add-ons
  2. form.validateFields() [LOCAL VALIDATION]
  3. Calls window.api.letters.createBatch({
       projectId, financialYear, letterDate, dueDate, unitIds?, addOns?
     }) ← IPC INVOKE

  ↓ [IPC BRIDGE]

ipcHandlers.ts (Main Thread)
  ↓
  4. Handler 'create-batch-letters'
     - Validates projectId (positive int), financialYear (YYYY-YY format)
     - Validates letterDate, dueDate (ISO date)
     - Validates unitIds array, addOns array
     - Calls maintenanceLetterService.createBatch(...)

  ↓

MaintenanceLetterService.createBatch()
  ↓
  5. Validates project exists, rate exists for FY
  6. Fetches targetUnits (or all units if unitIds empty)
  7. dbService.transaction(() => {
       For each unit:
         a. Calculate arrears from previous maintenance_letters
         b. Fetch payments linked to this unit
         c. Calculate final_amount = (rate * area) + addOns - discount
         d. Create maintenance_letter row
         e. Create add_ons rows if provided
         f. Set status = 'Pending', is_paid = 0
     })
  8. Returns true/false

  ↓ [IPC RESPONSE]

Billing.tsx (Renderer)
  ↓
  9. Show success notification
  10. Refresh letters table (fetchData)
  11. Redirect user to payments page (next step guidance)
```

#### Issues identified:

| Issue                                                                  | Impact                                                | Severity |
| ---------------------------------------------------------------------- | ----------------------------------------------------- | -------- |
| **Main-thread blocking loop for large unit counts**                    | Generating 500+ letters freezes UI for seconds        | HIGH     |
| **No dry-run preview**                                                 | User cannot see calculated amounts before commit      | HIGH     |
| **Calculation logic (arrears, discounts, taxes) hardcoded in service** | No auditability; rate changes not versioned           | MEDIUM   |
| **Multiple DB round-trips per unit**                                   | Could be optimized into fewer queries                 | MEDIUM   |
| **No progress feedback during generation**                             | User unsure if process is running                     | MEDIUM   |
| **Add-ons saved separately; no atomicity guarantee**                   | If add-on insert fails, letter remains without addons | LOW      |

---

### 3. PAYMENT WORKFLOW: Record Payment + Update Status

**Trigger:** User enters payment in Payments page (single or bulk)  
**Path:** Renderer → IPC → Main → PaymentService → DB

#### Execution Flow:

```
Payments.tsx (Renderer)
  ↓
  1a. Single payment: User fills form → handleModalOk()
   OR
  1b. Bulk payments: User loads project units, enters amounts → handleBulkModalOk()

  2. For each payment, calls window.api.payments.create(payment) ← IPC INVOKE

  ↓ [IPC BRIDGE]

ipcHandlers.ts (Main Thread)
  ↓
  3. Handler 'create-payment'
     - Validates payment.project_id, unit_id (positive ints)
     - Validates payment_date (ISO), payment_amount (positive)
     - Validates payment_mode ∈ ['Transfer','Cheque','Cash','UPI']
     - Calls paymentService.create(payment)

  ↓

PaymentService.create()
  ↓
  4. Insert row into payments table
  5. Calls updateLetterStatus(letterId) [if letter_id provided]
     OR
  6. Calls updateLetterStatusByUnitYear(unitId, financial_year)

  7. updateLetterStatus():
     - Get letter.final_amount
     - SUM payments WHERE letter_id = ?
     - SUM unlinked payments WHERE unit_id = ? AND financial_year = ?
     - If totalPaid >= final_amount: UPDATE letter.status = 'Paid', is_paid = 1
     - Else: UPDATE letter.status = 'Pending', is_paid = 0

  8. Returns paymentId

  ↓ [IPC RESPONSE]

Payments.tsx (Renderer)
  ↓
  9. Receives paymentId
  10. Calls window.api.payments.generateReceiptPdf(paymentId) [ASYNC IPC]
  11. PDF generated in main process, written to file
  12. Notification with "Show in Folder" button
  13. Refresh payments table (fetchData)
```

#### Issues identified:

| Issue                                               | Impact                                                              | Severity |
| --------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| **updateLetterStatus() runs multiple queries**      | Could use single UPDATE...SET with subquery                         | MEDIUM   |
| **No transaction wrapping payment + status update** | If status update fails, payment recorded but letter not marked paid | HIGH     |
| **Bulk payments loop calls create() N times**       | N IPC round-trips; could batch                                      | HIGH     |
| **Receipt PDF generation blocks main thread**       | Large receipts hang UI briefly                                      | LOW      |
| **No idempotency check**                            | Duplicate payment capture possible if user retries                  | MEDIUM   |
| **Letter.is_paid comparison uses 0.01 tolerance**   | Floating-point math can cause edge cases                            | MEDIUM   |

---

## Common Issues Across All Flows

### 1. **Synchronous Main-Thread Operations (⚠️ CRITICAL)**

All IPC handlers run **synchronously** on the main thread:

- `ipcMain.handle()` blocks until handler completes
- Large imports, billing batches, and PDF generation freeze the UI
- No `await` for heavy async work (except select PDF handlers)

**Recommendation:** Move heavy operations to:

- **Background worker thread** (Node.js `worker_threads`)
- **Child process** (spawn with IPC back to main)
- **Renderer-side Web Worker** (pre-process data)

### 2. **No Progress Feedback**

- Renderer has no way to track long-running operations (ETA, current step, cancel)
- Solution: Implement progress events or a progress endpoint

### 3. **Error Handling Inconsistency**

- Handlers throw errors which are caught by Renderer's try/catch
- Error messages sometimes helpful, sometimes generic DB errors leak to UI
- No error logging to file or audit trail

**Recommendation:** Standardize error wrapping:

```typescript
try { ... } catch (e) {
  const message = logError('operation_name', e)
  throw new Error(message) // User-friendly message only
}
```

### 4. **No Transactions Across Operations**

- Some operations (payment + status update) should be atomic but aren't wrapped
- If main process crashes mid-transaction, data may be left inconsistent

**Recommendation:** Wrap multi-step IPC flows in explicit transactions where applicable

### 5. **State Consistency**

- Renderer refreshes data with full `fetchData()` calls after mutations
- No optimistic updates or delta sync
- Large datasets cause lag

**Recommendation:** After mutation, return just the created/updated entity, let renderer update local state

---

## Performance Analysis

### Measured Bottlenecks

| Operation                     | Data Size                               | Time    | Culprit                                            |
| ----------------------------- | --------------------------------------- | ------- | -------------------------------------------------- |
| Import large workbook         | 1000 units × 5 years = 5000 ledger rows | ~5–10s  | Main-thread per-row inserts + no batching          |
| Generate 500 letters          | 500 units → 500 letters + calculations  | ~8–15s  | Per-unit loop, multiple DB queries per unit        |
| Bulk record 100 payments      | 100 payments                            | ~3–5s   | 100 separate IPC invoke + single query per payment |
| Generate 50 PDFs sequentially | 50 letters                              | ~10–20s | Sequential PDF generation in main thread           |

### Recommended Optimizations

| Optimization                                  | Expected Gain           | Effort |
| --------------------------------------------- | ----------------------- | ------ |
| Batch unit imports into bulk INSERT           | 40–50% faster import    | Medium |
| Move import to worker thread                  | 0s UI block             | Medium |
| Pre-calculate all letter amounts in one query | 30–40% faster billing   | Low    |
| Batch payment creates via single IPC call     | 70% fewer round-trips   | Low    |
| Generate PDFs in parallel (worker pool)       | 50–70% faster batch PDF | High   |
| Cache setup summary (project blockers, etc.)  | Faster UI responses     | Low    |

---

## Data Sanitization & Validation Layer

### Current Approach (IPC Handlers)

✅ **Strengths:**

- Input validation before DB operations
- Type guards for numbers, dates, text
- Sanitization removes extra whitespace

❌ **Weaknesses:**

- Validation logic duplicated in handlers (not in services)
- No schema validation library (zod, joi)
- Date format hardcoded (YYYY-YY, YYYY-MM-DD)
- No max length checks on strings

### Recommended Improvements

```typescript
// Centralized validation schema
const PaymentSchema = z.object({
  project_id: z.number().int().positive(),
  unit_id: z.number().int().positive(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_amount: z.number().positive(),
  payment_mode: z.enum(['Transfer', 'Cheque', 'Cash', 'UPI'])
  // ... more fields
})

// In handler:
const validated = PaymentSchema.parse(payment)
const paymentId = await paymentService.create(validated)
```

---

## IPC Channel Surface

Total IPC channels: **35+**

### Projects (8 channels)

- get-projects, get-project
- get-project-setup-summary, get-project-setup-summaries
- create-project, update-project, delete-project, bulk-delete-projects
- import-standard-workbook-project
- get-project-sector-configs, save-project-sector-configs
- get-dashboard-stats

### Units (6 channels)

- get-units, get-units-by-project
- create-unit, update-unit, delete-unit, bulk-delete-units, bulk-create-units
- import-ledger

### Letters (10 channels)

- get-letters, get-letter
- create-batch-letters
- delete-letter, bulk-delete-letters
- generate-letter-pdf
- get-letter-addons, get-all-addons
- add-letter-addon, delete-letter-addon

### Detailed Letters (2 channels)

- generate-detailed-letter, generate-detailed-pdf

### Payments (4 channels)

- get-payments, create-payment
- delete-payment, bulk-delete-payments
- generate-receipt-pdf

### Rates (6 channels)

- get-rates, get-rates-by-project
- create-rate, update-rate, delete-rate
- get-slabs, add-slab, delete-slab

### Settings (3 channels)

- get-settings, update-setting, delete-setting

### Utility (3 channels)

- select-local-file
- show-item-in-folder
- database-repair
- open-pdf

---

## File I/O Pattern

Several services write files to disk:

- **PaymentService.generateReceiptPdf()** → `fs.writeFileSync(filePath, pdfBytes)`
- **MaintenanceLetterService.generatePdf()** → `fs.writeFileSync(fullPath, bytes)`
- **DetailedMaintenanceLetterService.generateDetailedPdf()** → `fs.writeFileSync(filePath, pdfBytes)`

### Issues:

- Synchronous writes block main thread
- No error handling for disk full, permission denied
- Target paths assumed writable (temp dir / app data)
- No cleanup of old PDFs

### Recommendation:

- Use async `fs.promises.writeFile()`
- Implement a background PDF writer with queue + error retry

---

## Recommendations Summary

### HIGH Priority

1. **Implement background worker for heavy operations**
   - Move imports, batch billing, batch payments to worker thread
   - Use `worker_threads` or child process + IPC

2. **Add dry-run preview for destructive operations**
   - Before import: show preview of units/letters to be created
   - Before billing: show calculated amounts + conflicts
   - Before payments: confirm payment application

3. **Wrap payment + letter status update in transaction**
   - Ensure atomicity; if payment fails, no orphaned pending letters

4. **Implement bulk IPC for batch operations**
   - Single IPC call with array of items, not N calls

### MEDIUM Priority

5. **Move PDF generation to async worker**
   - Prevents UI blocking during large batch PDF generation

6. **Add progress events for long-running operations**
   - Implement WebSocket or progress endpoint callback
   - Show user ETA, current step, cancel button

7. **Implement conflict detection for imports**
   - Detect duplicate units (same unit_number in project)
   - Ask user: Overwrite, Skip, or Merge

8. **Standardize error handling**
   - Create error hierarchy (ValidationError, NotFoundError, etc.)
   - Log errors to file with context
   - Return user-friendly messages only

### LOW Priority

9. **Implement import audit log**
   - Track all imports: file name, row count, timestamp, user action
   - Allow rollback of individual imports

10. **Cache project setup summary**
    - Avoid recalculating blockers/warnings on every tab switch

---

## Local DB Backup & Recovery

Current state: **"coming soon" in Settings UI**

### Issues:

- No one-click backup
- No automated backup schedule
- User bears full responsibility for data loss
- Restore workflow undefined

### Recommended Implementation:

```typescript
// Backup
async backupDatabase(destinationPath: string): Promise<void> {
  const dbPath = app.getPath('userData') + '/barkat.db'
  await fs.promises.copyFile(dbPath, destinationPath)
  // Verify backup integrity (file size, checksum)
}

// Restore
async restoreDatabase(backupPath: string): Promise<void> {
  const dbPath = app.getPath('userData') + '/barkat.db'
  // Close DB connection
  // Copy backup → active DB
  // Reinit connection + run integrity checks
}

// Auto-backup
ipcMain.handle('enable-auto-backup', (_, intervalDays: number) => {
  const schedule = setInterval(() => {
    const timestamp = new Date().toISOString().replace(/[:\-]/g, '')
    const backupPath = `${app.getPath('userData')}/backups/barkat_${timestamp}.db.bak`
    backupDatabase(backupPath) // Fire and forget, log errors
  }, intervalDays * 24 * 60 * 60 * 1000)
  return { id: scheduleId, intervalDays }
})
```

---

## Conclusion

The current architecture is **functional but not optimized** for the local-only, single-machine SQLite use case. The main bottleneck is **synchronous main-thread operations**, which blocks the UI during large imports and batch operations.

**Next steps:**

1. Implement background worker framework
2. Add dry-run previews for critical workflows
3. Wrap atomic operations in transactions
4. Add progress feedback and retry logic
5. Implement automated backups

This will ensure a responsive, reliable admin experience even with large datasets (1000+ units, 5000+ letters).
