<div align="center">

# 🏢 Barkat — Property Maintenance Management

> **Desktop application for housing society maintenance billing, unit management, payments, and PDF letter generation.**
>
> Built with Electron 39 + React 19 + TypeScript + SQLite. Runs fully offline — all data stored locally.

[![Electron](https://img.shields.io/badge/Electron-39.2.6-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.2.1-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

</div>

---

## 📋 Table of Contents

- [What This App Does](#what-this-app-does)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [How to Import Data (Standard Workbook)](#how-to-import-data-standard-workbook)
- [Manual Data Entry Guide](#manual-data-entry-guide)
- [Building for Production](#building-for-production)
- [Troubleshooting](#troubleshooting)

---

## 🎯 What This App Does

Barkat manages housing society maintenance operations:

| Module | What it does |
|---|---|
| **Projects** | Create/manage housing societies with bank and QR details |
| **Units** | Manage individual plots/flats with owner info, area, sector |
| **Billing** | Generate maintenance letters in bulk per financial year |
| **Payments** | Record and track payment receipts with PDF generation |
| **Reports** | View outstanding dues, collection summaries, payment history |
| **Settings** | Backup, restore, and repair the SQLite database |

---

## 📋 Requirements

| Tool | Minimum Version |
|---|---|
| Node.js | 18.x or higher |
| npm | 9.x or higher |
| Git | Any recent version |
| OS | Windows 10+, macOS 10.13+, Ubuntu 16.04+ |

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone <repository-url>
cd Barkat_vo-main

# 2. Install dependencies
npm install

# 3. Start in development mode
npm run dev
```

The app window opens automatically. Hot reload is active — changes to renderer files refresh instantly.

### Available Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Electron in dev mode with hot reload |
| `npm run build` | Type-check + build for production |
| `npm run build:win` | Build Windows installer (.exe) |
| `npm run build:mac` | Build macOS app (.dmg) |
| `npm run build:linux` | Build Linux AppImage + .deb |
| `npm run typecheck` | Run TypeScript checks only |
| `npm run lint` | Run ESLint |
| `npm test` | Run Jest unit tests |

---

## 📁 Project Structure

```
src/
├── main/                    # Electron main process (Node.js)
│   ├── index.ts             # App entry, window creation
│   ├── ipcHandlers.ts       # All IPC bridge handlers
│   ├── db/
│   │   ├── database.ts      # SQLite connection + query helpers
│   │   └── schema.ts        # Table definitions + migrations
│   ├── services/            # Business logic layer
│   │   ├── ProjectService.ts
│   │   ├── UnitService.ts
│   │   ├── MaintenanceLetterService.ts
│   │   ├── PaymentService.ts
│   │   ├── MaintenanceRateService.ts
│   │   ├── BackupService.ts
│   │   ├── AddonTemplateService.ts
│   │   ├── BatchOperationsService.ts
│   │   ├── BasePDFGenerator.ts
│   │   ├── EnhancedPDFGenerator.ts
│   │   ├── InvoiceGenerator.ts
│   │   ├── MaintenanceBillService.ts (→ now MaintenanceLetterService)
│   │   └── DetailedMaintenanceLetterService.ts
│   ├── types/
│   │   ├── enums.ts         # ProjectStatus, UnitStatus enums
│   │   └── pdf.ts           # PDF generation types
│   └── utils/
│       ├── dateUtils.ts
│       ├── errorHandler.ts
│       ├── fileAsync.ts
│       ├── logger.ts
│       ├── numberToWords.ts
│       └── workerPool.ts
│
├── preload/
│   ├── index.ts             # contextBridge API definition
│   ├── index.d.ts           # TypeScript types for window.api
│   └── types.ts             # Shared types (Project, Unit, Payment…)
│
└── renderer/src/            # React frontend
    ├── App.tsx              # Router + Ant Design theme
    ├── main.tsx             # React entry point
    ├── pages/
    │   ├── Dashboard.tsx    # Stats overview
    │   ├── Projects.tsx     # Project CRUD + workbook import
    │   ├── Units.tsx        # Unit CRUD + Excel import
    │   ├── Billing.tsx      # Letter generation
    │   ├── Payments.tsx     # Payment recording
    │   ├── Reports.tsx      # Reports and exports
    │   └── Settings.tsx     # DB backup/restore/repair
    ├── components/
    │   ├── Layout.tsx
    │   ├── MaintenanceRateModal.tsx
    │   ├── DetailedMaintenanceLetterModal.tsx
    │   ├── ConfirmationDialog.tsx
    │   ├── BreadcrumbNavigation.tsx
    │   └── ErrorBoundary.tsx
    └── utils/
        ├── excelReader.ts       # Excel/CSV reading (ExcelJS + SheetJS)
        ├── importHelpers.ts     # Row normalization, key matching
        ├── standardWorkbook.ts  # Standard 3-sheet workbook parser
        └── workflowGuidance.tsx # Post-action next-step prompts
```

---

## 📥 How to Import Data (Standard Workbook)

The **fastest way** to get data into Barkat is using the **Standard Workbook Import** on the Projects page. This imports Projects, Units, and their maintenance history in one shot.

### Step 1 — Prepare your Excel file

Create an `.xlsx` file with **exactly 3 sheets** named:

| Sheet Name | Purpose |
|---|---|
| `Project` | One row per project/society |
| `Units` | One row per unit/plot |
| `Ledger` | One row per unit per financial year |

Sheet names are case-insensitive (`project`, `Project`, `PROJECT` all work).

---

### Sheet: `Project`

| Column | Required | Notes |
|---|---|---|
| `project_name` | ✅ | Must be unique. Used as the join key. |
| `address` | — | Full address of the society |
| `city` | — | Defaults to nothing if blank |
| `state` | — | |
| `pincode` | — | |
| `status` | — | `Active` or `Inactive`. Defaults to `Active`. |
| `template_type` | — | `standard` / `sector_legacy` / `reminder_legacy`. Defaults to `standard`. |
| `import_profile_key` | — | `standard_normalized` / `beverly_abc_v1` / `banjara_numeric_v1`. Defaults to `standard_normalized`. |
| `account_name` | — | Bank account holder name |
| `bank_name` | — | |
| `account_no` | — | |
| `ifsc_code` | — | |
| `branch` | — | |
| `branch_address` | — | |
| `qr_code_path` | — | Absolute path to QR image on disk |

**Example:**

| project_name | city | status | bank_name | account_no | ifsc_code |
|---|---|---|---|---|---|
| Green Valley Society | Ahmedabad | Active | SBI | 12345678901 | SBIN0001234 |

---

### Sheet: `Units`

| Column | Required | Notes |
|---|---|---|
| `project_name` | ✅ | Must match exactly the Project sheet |
| `unit_number` | ✅ (or sector+plot) | E.g. `A-001`, `B-042` |
| `sector_code` | — | Alternative to full unit_number. Used with `plot_number`. |
| `plot_number` | — | Combined with sector_code → `A-001` |
| `owner_name` | ✅ | |
| `area_sqft` | ✅ | Numeric. Defaults to 1000 if blank. |
| `unit_type` | — | `Plot` / `Bungalow` / `Garden`. Defaults to `Bungalow`. |
| `status` | — | `Active` / `Inactive` / `Vacant`. Defaults to `Active`. |
| `contact_number` | — | |
| `email` | — | |
| `penalty` | — | Opening balance penalty (number) |
| `billing_address` | — | Postal address for letters |
| `resident_address` | — | Current residential address |

**Example:**

| project_name | unit_number | owner_name | area_sqft | unit_type |
|---|---|---|---|---|
| Green Valley Society | A-001 | Ramesh Patel | 220 | Plot |
| Green Valley Society | B-015 | Sonal Shah | 180 | Bungalow |

---

### Sheet: `Ledger`

One row per unit per financial year. Only rows with a payable amount are imported.

| Column | Required | Notes |
|---|---|---|
| `project_name` | ✅ | Must match Project sheet |
| `unit_number` | ✅ (or sector+plot) | Must match Units sheet |
| `financial_year` | ✅ | Format: `2023-24` (YYYY-YY) |
| `maintenance_amount` / `base_amount` | ✅ | Base maintenance charge |
| `arrears` | — | Carry-forward outstanding from prior year |
| `discount_amount` | — | Early payment discount |
| `final_amount` | — | Override for calculated total |
| `due_date` | — | Format: `YYYY-MM-DD` or `DD-MM-YYYY` |
| `penalty` / `penalty_amount` | — | Per-year penalty amount |
| `na_tax` | — | Non-agricultural tax charge |
| `road_na` / `rd & na` | — | Road + NA charges |
| `cable` | — | Cable TV charges |
| `gst` | — | GST amount |
| `pipe_replacement` | — | Pipe replacement fund |
| `other_charge_name` | — | Label for a custom extra charge |
| `other_charge_amount` | — | Amount for the custom charge |

**Example:**

| project_name | unit_number | financial_year | maintenance_amount | arrears | due_date |
|---|---|---|---|---|---|
| Green Valley Society | A-001 | 2023-24 | 5500 | 0 | 2023-07-31 |
| Green Valley Society | A-001 | 2024-25 | 6000 | 0 | 2024-07-31 |
| Green Valley Society | B-015 | 2024-25 | 4800 | 1200 | 2024-07-31 |

---

### Step 2 — Import the workbook

1. Go to **Projects** page
2. Click **Import Standard Workbook**
3. Select your `.xlsx` file
4. Review the preview — check for blockers (red) and warnings (yellow)
5. Click **Confirm Import**

The import is **idempotent** — re-importing the same workbook updates existing records rather than duplicating them.

---

## ✍️ Manual Data Entry Guide

If you prefer to add data directly through the UI:

### 1. Create a Project

Projects → **New Project** → Fill in:
- Project Name (required)
- City, Address, State, Pincode
- Bank details (for PDF letters)
- QR code path (optional, for QR on letters)
- Template Type: choose `Standard Letter` for most cases

### 2. Set Maintenance Rates

Projects → click a project → **Manage Rates**
- Set rate per sqft per financial year
- Set separate rates for different unit types (Plot vs Bungalow)

### 3. Add Units

Units → select project from dropdown → **Add Unit**
- Unit Number (e.g. `A-001`)
- Owner Name, Area (sqft), Unit Type
- Contact Number, Email (used in letters)

Or use **Import from Excel** for bulk unit entry. The Excel file needs columns:
`unit_number`, `owner_name`, `area_sqft`, `unit_type`, `contact_number`, `email`

### 4. Generate Maintenance Letters (Billing)

Billing → **Generate Letters**
1. Select Project + Financial Year
2. Set Letter Date and Due Date
3. Optionally add extra line items (penalty, NA tax, etc.)
4. Click Generate

Letters appear in the table. Click the PDF icon to download.

### 5. Record Payments

Payments → **Add Payment**
- Select Project + Unit
- Link to a maintenance letter (optional)
- Enter amount, date, payment mode, cheque number

A receipt PDF can be generated from the Payments table.

---

## 🏗️ Building for Production

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux (AppImage + .deb)
npm run build:linux
```

Output goes into `dist/`. The app is fully self-contained — the SQLite database is created on first launch in the user's app data directory.

> **Note for Windows builds:** Requires Visual Studio Build Tools for native `better-sqlite3` compilation.
> Run `npm install --global windows-build-tools` if you hit build errors.

---

## 🔧 Troubleshooting

### App won't start after `npm run dev`

```bash
# Ensure native modules are built
npm run postinstall

# Clear electron cache
npx electron --clear-cache
```

### TypeScript errors on `window.api.*`

The type definitions live in `src/preload/index.d.ts`. If you add new IPC handlers in `ipcHandlers.ts`, also add them to:
1. `src/preload/index.ts` (the actual bridge)
2. `src/preload/index.d.ts` (the types)

### Import fails with "Project not found in Units sheet"

The `project_name` in the Units/Ledger sheet must be an **exact match** (case-insensitive) to the `project_name` in the Project sheet.

### Letters won't generate — "Project setup is incomplete"

Check that:
1. Maintenance rates are configured for the financial year (Projects → Manage Rates)
2. At least one unit exists in the project
3. Bank or QR details are filled in (optional but needed for complete letters)

### Database errors / data corruption

Go to **Settings → Check & Repair Database**. This runs a foreign key integrity check and logs any violations.

To restore from backup: **Settings → Restore from Backup** and select a `.db` file.

---

## 🗂️ Database

Barkat uses **SQLite** via `better-sqlite3`. The database file (`barkat.db`) is stored locally.

Key tables:
- `projects` — societies
- `units` — individual plots/flats
- `maintenance_letters` — billing records per unit per year
- `add_ons` — extra charges attached to letters
- `payments` — payment records
- `maintenance_rates` — rate per sqft per unit type per year
- `maintenance_slabs` — early payment discount slabs
- `project_sector_payment_configs` — sector-specific QR codes
- `addon_templates` — reusable add-on presets per project
- `settings` — key-value app settings
#   B a r k a t _ f i n a l  
 