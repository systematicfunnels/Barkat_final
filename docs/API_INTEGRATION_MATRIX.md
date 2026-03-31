# Barkat API Integration Matrix

## Scope

This document defines the real frontend-to-backend contract for Barkat.

- Frontend: React renderer in `src/renderer`
- Bridge: preload API in `src/preload/index.ts`
- Backend: Electron main process handlers in `src/main/ipcHandlers.ts`
- Persistence: SQLite schema in `src/main/db/schema.ts`
- File side effects: PDFs, backups, asset copy/validation, shell and dialog access

## Integration Rules

1. Renderer must call only `window.api.*`.
2. Preload is the only allowed bridge across context isolation.
3. Main process validates all IDs, dates, enums, and payload shape.
4. Services own business logic and DB transactions.
5. Renderer owns only UI state, not domain truth.

## System Boundary

```text
[Renderer Pages]
      |
      v
[window.api preload bridge]
      |
      v
[IPC handlers]
      |
      +--> [Services]
      |       |
      |       +--> [SQLite]
      |       +--> [Filesystem / PDFs]
      |       +--> [Workers]
      |
      +--> [Electron shell/dialog]
```

## Shared Entity Shapes

| Entity | Primary Keys / Identity | Notes |
| --- | --- | --- |
| `Project` | `id` | top-level society/project |
| `Unit` | `id`, unique `project_id + unit_number` | belongs to project |
| `MaintenanceLetter` | `id`, unique `unit_id + financial_year` | billing record |
| `Payment` | `id` | belongs to project + unit, optional letter |
| `MaintenanceRate` | `id` | project + financial year + unit type |
| `MaintenanceSlab` | `id` | belongs to rate |
| `ProjectSectorPaymentConfig` | `id`, unique `project_id + sector_code` | bank/QR override |
| `ProjectAddonTemplate` | `id` | reusable add-ons |

## Screen Matrix

### Dashboard

| Screen | IPC Method | Request | Response | Validation | Side Effects | Failure Behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard | `projects.getDashboardStats(projectId?, financialYear?, unitType?, status?)` | optional scalar filters | `{ projects, units, pendingUnits, collectedThisYear, totalBilled, totalOutstanding }` | optional filters only | read-only aggregate query | errors reject Promise to renderer |

### Projects

| Screen | IPC Method | Request | Response | Validation | Side Effects | Failure Behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Projects | `projects.getAll()` | none | `Project[]` | none | DB read | Promise reject on DB/query error |
| Projects | `projects.getById(id)` | `number` | `Project \| undefined` | numeric id expected | DB read | Promise reject on downstream error |
| Projects | `projects.create(project)` | `Project` | `number` | `name` required | insert project | throws `Project name is required` |
| Projects | `projects.update(id, partial)` | `number, Partial<Project>` | `boolean` | project status enum if provided | update project | throws invalid project status message |
| Projects | `projects.delete(id)` | `number` | `boolean` | implicit service expectations | delete project cascade | Promise reject on service/db failure |
| Projects | `projects.bulkDelete(ids)` | `number[]` | `boolean` | ids array expected | bulk delete | Promise reject on service/db failure |
| Projects | `projects.getSetupSummary(projectId, financialYear?)` | `number, string?` | `ProjectSetupSummary` | positive project id, FY `YYYY-YY` | DB reads and setup analysis | throws invalid project / FY error |
| Projects | `projects.getSetupSummaries(financialYear?)` | `string?` | `ProjectSetupSummary[]` | FY `YYYY-YY` if present | DB reads and setup analysis | throws invalid FY error |
| Projects | `projects.getSectorPaymentConfigs(projectId)` | `number` | `ProjectSectorPaymentConfig[]` | positive project id | DB read | throws `Invalid project selected` |
| Projects | `projects.saveSectorPaymentConfigs(projectId, configs)` | `number, Partial<ProjectSectorPaymentConfig>[]` | `boolean` | project id positive, array required, sector required for populated row, no duplicates | upsert sector config rows | throws payload/duplicate/sector errors |
| Projects | `projects.getChargesConfig(projectId)` | `number` | `Record<string, unknown> \| null` | positive project id | DB read | throws `Invalid project selected` |
| Projects | `projects.saveChargesConfig(config)` | config object | `boolean` | project id positive, non-negative amounts, percentages 0-100 | insert/update charges config | throws explicit validation errors |
| Projects | `projects.getAddonTemplates(projectId)` | `number` | `ProjectAddonTemplate[]` | positive id expected by service | DB read | Promise reject on error |
| Projects | `projects.getEnabledAddonTemplates(projectId)` | `number` | `ProjectAddonTemplate[]` | positive id expected by service | DB read | Promise reject on error |
| Projects | `projects.createAddonTemplate(template)` | template object | `ProjectAddonTemplate` | project id positive, valid type, amount > 0, boolean enabled, sort order positive | insert addon template | throws explicit validation errors |
| Projects | `projects.updateAddonTemplate(id, template)` | `number, partial template` | `ProjectAddonTemplate` | valid id and field-level validation | update addon template | throws explicit validation errors |
| Projects | `projects.deleteAddonTemplate(id)` | `number` | `boolean` | positive id | delete addon template | throws `Invalid template ID` |
| Projects | `projects.reorderAddonTemplates(templates)` | `Array<{ id, sort_order }>` | `boolean` | array required, each id/sort order positive | bulk reorder update | throws explicit validation errors |
| Projects | `projects.initializeDefaultAddonTemplates(projectId)` | `number` | `boolean` | positive project id | insert defaults | throws `Invalid project selected` |
| Projects | `projects.migrateAddonTemplates(projectId)` | `number` | `{ migrated, templates }` | positive project id | migration write | throws `Invalid project selected` |
| Projects | `projects.importStandardWorkbookProject(payload)` | workbook payload | import result object | project name required, rows array required, sector config array shape if present | creates/merges project, units, letters, rates, payments | throws workbook payload errors |

### Units

| Screen | IPC Method | Request | Response | Validation | Side Effects | Failure Behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Units | `units.getAll()` | none | `Unit[]` | none | DB read | Promise reject on DB/query error |
| Units | `units.getByProject(projectId)` | `number` | `Unit[]` | service expects valid project id | DB read | Promise reject on error |
| Units | `units.create(unit)` | `Unit` | `number` | positive `project_id`, required `unit_number`, `owner_name`, `area_sqft > 0` | insert unit | throws explicit validation errors |
| Units | `units.update(id, partial)` | `number, Partial<Unit>` | `boolean` | valid unit status enum if provided | update unit with normalization | throws invalid status error |
| Units | `units.delete(id)` | `number` | `boolean` | implicit valid unit id | delete unit with cascades | Promise reject on service/db error |
| Units | `units.bulkDelete(ids)` | `number[]` | `boolean` | ids array expected | bulk delete with cascades | Promise reject on error |
| Units | `units.bulkCreate(units)` | `Unit[]` | `boolean` | service-level validation/normalization | bulk insert | Promise reject on error |
| Units | `units.importLedger({ projectId, rows })` | `{ projectId, rows }` | `boolean` | service-level import expectations | transaction across units and related entities | Promise reject on import/service error |

### Billing / Maintenance Letters

| Screen | IPC Method | Request | Response | Validation | Side Effects | Failure Behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Billing | `letters.getAll()` | none | `MaintenanceLetter[]` | none | DB read | Promise reject on DB/query error |
| Billing | `letters.getByProject(projectId)` | `number` | `MaintenanceLetter[]` | positive project id | DB read | throws `Invalid project selected` |
| Billing | `letters.getById(id)` | `number` | `MaintenanceLetter \| undefined` | implicit | DB read | Promise reject on error |
| Billing | `letters.createBatch(params)` | `{ projectId, unitIds?, financialYear, letterDate, dueDate, addOns? }` | `boolean` | positive project id, FY `YYYY-YY`, dates `YYYY-MM-DD`, unit id array if present, valid add-ons | inserts letters and add-ons, computes arrears/GST/discount | throws explicit batch validation or service errors |
| Billing | `letters.update(id, updates)` | `number, Partial<MaintenanceLetter>` | `boolean` | only allowed fields are applied | update letter | returns `false` or rejects on DB error |
| Billing | `letters.delete(id)` | `number` | `boolean` | implicit | delete letter | Promise reject on error |
| Billing | `letters.bulkDelete(ids)` | `number[]` | `boolean` | ids array expected | bulk delete letters | Promise reject on error |
| Billing | `letters.generatePdf(id)` | `number` | `string` file path | letter must exist, required bank details must exist | writes PDF file, updates `pdf_path` | throws missing letter/bank details/file errors |
| Billing | `letters.getAddOns(id)` | `number` | `LetterAddOn[]` | implicit | DB read | Promise reject on error |
| Billing | `letters.getAllAddOns()` | none | add-on list | none | DB read | Promise reject on error |
| Billing | `letters.addAddOn(params)` | `{ unit_id, financial_year, addon_name, addon_amount, remarks? }` | `boolean` | service must find target letter | insert add-on, update letter final amount | returns `false` or rejects on error |
| Billing | `letters.deleteAddOn(id)` | `number` | `boolean` | add-on must exist | delete add-on, update letter final amount | returns `false` or rejects on error |
| Billing | `detailedLetters.generateLetter(projectId, unitId, financialYear)` | scalars | `LetterCalculation` | positive ids, FY `YYYY-YY` | calculation only | throws explicit validation errors |
| Billing | `detailedLetters.generatePdf(projectId, unitId, financialYear)` | scalars | `string` file path | positive ids, FY `YYYY-YY`, existing letter required | PDF write | throws explicit validation/service errors |

### Payments

| Screen | IPC Method | Request | Response | Validation | Side Effects | Failure Behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Payments | `payments.getAll()` | none | `Payment[]` | none | DB read | Promise reject on DB/query error |
| Payments | `payments.getByProject(projectId)` | `number` | `Payment[]` | positive project id | DB read | throws `Invalid project selected` |
| Payments | `payments.create(payment)` | `Payment` | `number` | positive project/unit ids, unit must belong to project, optional positive letter id, ISO date, amount > 0, FY `YYYY-YY`, mode in allowed list | insert payment, logging side effect | throws explicit validation errors |
| Payments | `payments.update(id, partial)` | `number, Partial<Payment>` | `boolean` | positive payment id | update payment | throws `Invalid payment ID` |
| Payments | `payments.delete(id)` | `number` | `boolean` | implicit | delete payment | Promise reject on error |
| Payments | `payments.bulkDelete(ids)` | `number[]` | `boolean` | ids array expected | bulk delete | Promise reject on error |
| Payments | `payments.generateReceiptPdf(id)` | `number` | `string` file path | payment must exist | writes receipt PDF | throws missing payment or file/PDF errors |
| Payments | `batch.createPayments(payments)` | `Payment[]` | `{ successful, failed, results[] }` | payments array required | bulk create payments | returns partial failures or throws validation error |
| Payments | `batch.deletePayments(paymentIds)` | `number[]` | `{ successful, failed, results[] }` | payment id array required | bulk delete payments | returns partial failures or throws validation error |

### Reports

| Screen | IPC Method | Request | Response | Validation | Side Effects | Failure Behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Reports | `projects.getAll()` | none | `Project[]` | none | DB read | Promise reject on error |
| Reports | `units.getAll()` / `units.getByProject(projectId)` | none or `number` | `Unit[]` | project id where applicable | DB read | Promise reject on error |
| Reports | `letters.getAll()` / `letters.getByProject(projectId)` | none or `number` | `MaintenanceLetter[]` | project id where applicable | DB read | Promise reject on error |
| Reports | `payments.getAll()` / `payments.getByProject(projectId)` | none or `number` | `Payment[]` | project id where applicable | DB read | Promise reject on error |

Notes:

- Reports are currently renderer-aggregated.
- There is no dedicated report IPC endpoint yet.
- Renderer composes pivots, totals, and summaries from raw records.

### Settings / System

| Screen | IPC Method | Request | Response | Validation | Side Effects | Failure Behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Settings | `settings.getAll()` | none | `unknown[]` | none | DB read | Promise reject on error |
| Settings | `settings.update(key, value)` | `string, string` | DB run result | caller must supply key/value | upsert settings row | Promise reject on DB error |
| Settings | `settings.delete(key)` | `string` | DB run result | key required | delete setting | Promise reject on DB error |
| Settings | `database.repair()` | none | `{ success, violations, logs }` | none | DB maintenance and cleanup | returns `success: false` on fatal failure |
| Settings | `logging.getErrorLogs(limit?)` | optional number | log array | none | log read | Promise reject on error |
| Settings | `logging.clearErrorLogs()` | none | `{ cleared: true }` | none | clears logs | Promise reject on error |
| Settings | `backup.createBackup()` | none | `{ success, backupPath?, error? }` | none | creates DB backup file | throws safe error on failure |
| Settings | `backup.restoreBackup(backupPath)` | `string` | restore result object | backup path required | restore DB, may relaunch app | throws safe error on failure |
| Settings | `backup.listBackups()` | none | `string[]` | none | filesystem read | Promise reject on error |
| Settings | `backup.startAutoBackup(intervalDays?)` | optional number | `{ enabled, intervalDays }` | none | starts scheduler | Promise reject on error |
| Settings | `backup.stopAutoBackup()` | none | `{ enabled: false }` | none | stops scheduler | Promise reject on error |
| Settings | `backup.getConfig()` | none | `{ enabled, intervalDays }` | none | config read | Promise reject on error |
| Settings | `dialog.selectLocalFile(options)` | dialog options | `string \| null` | optional dialog shape | opens OS dialog | returns `null` on cancel |
| Settings | `dialog.saveFile(options)` | dialog options | `string \| null` | filters sanitized internally | opens OS save dialog | returns `null` on cancel |
| Settings | `files.copyAssetFile(sourcePath, targetPath)` | `string, string` | `{ success, targetPath?, sourcePath?, size?, error? }` | source and target required, ext png/jpg/jpeg only, max 5MB | copies file under app data | returns `{ success: false, error }` on failure |
| Settings | `files.validateAssetFile(assetPath)` | `string` | `{ exists, isValidImage, path, error? }` | asset path required | filesystem validation | returns `{ exists: false, error }` on failure |
| Settings | `shell.showItemInFolder(path)` | `string` | `void` | must stay within app userData path | opens OS folder view | throws access denied if outside allowed dir |

### Dry Run

| Area | IPC Method | Request | Response | Validation | Side Effects | Failure Behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Dry Run | `dryRun.previewImport(projectId, rows)` | `number, unknown[]` | `{ valid, conflicts[], summary }` | positive project id, rows array required | read-only preview | throws safe validation error |
| Dry Run | `dryRun.previewBilling(projectId, financialYear, unitIds?)` | `number, string, number[]?` | `{ valid, conflicts[], summary }` | positive project id, FY `YYYY-YY` | read-only preview | throws safe validation error |
| Dry Run | `dryRun.previewPayment(unitId, projectId)` | `number, number` | `{ valid, conflicts[], summary }` | positive ids | read-only preview | throws safe validation error |

### Worker / Background Tasks

| Area | IPC Method | Request | Response | Validation | Side Effects | Failure Behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Worker | `worker.enqueueTask(taskType, data)` | `string, Record<string, unknown>` | `{ taskId, status: "queued" }` | task type and data supplied by caller | queues background work | throws safe error |
| Worker | `worker.getStatus(taskId)` | `string` | worker status object | task id expected | worker status lookup | Promise reject on worker error |
| Worker | `worker.cancel(taskId)` | `string` | `{ taskId, cancelled: true }` | task id expected | cancel request | Promise reject on worker error |
| Worker | `worker.onProgress(callback)` | callback | event stream | renderer only | subscribes to `worker-progress` event | no Promise; event callback only |

## Common Validation Rules

| Rule | Format |
| --- | --- |
| Positive integer IDs | `> 0` and integer |
| Financial year | `YYYY-YY` |
| ISO date | `YYYY-MM-DD` |
| Payment mode | `Cash`, `Cheque`, `UPI`, `Transfer` |
| Project status | `ProjectStatus` enum |
| Unit status | `UnitStatus` enum |
| Non-negative amount | `>= 0` |
| Positive amount | `> 0` |

## Error Handling Rules

1. Validation errors should fail before hitting service logic.
2. Renderer should treat rejected Promises as authoritative failure.
3. Dry-run, backup, and batch handlers already wrap many errors into safe messages.
4. CRUD handlers are still mixed: some throw raw `Error`, some sanitize.
5. File APIs are inconsistent today:
   - some throw
   - some return `{ success: false, error }`

## State Ownership

| State | Owner |
| --- | --- |
| Form inputs | renderer |
| Filters and search | renderer |
| Modal open/close | renderer |
| Loading/progress display | renderer |
| Business validation authority | main process |
| Domain calculations | services |
| Persistence | SQLite |
| File output paths | main process |
| Background task queue | worker pool |

## Known Contract Gaps

1. Reports do not have a dedicated backend aggregation contract yet.
2. Error shapes are not standardized across all methods.
3. Return types vary between boolean, id, string path, and rich object.
4. A future normalization pass should define:
   - standard success envelope
   - standard validation error envelope
   - standard side-effect result envelope
