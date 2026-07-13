# 🏢 Barkat – Property Maintenance Management

Desktop application for managing housing society maintenance, billing, payments, and reports.

**Tech Stack:** Electron 39 • React 19 • TypeScript • SQLite

---

## ✨ Features

* 🏘️ Project & Society Management
* 👥 Unit & Owner Management
* 💰 Maintenance Billing
* 🧾 Payment & Receipt Generation
* 📄 PDF Letter Generation
* 📊 Reports & Outstanding Dues
* 💾 Backup & Restore
* 📥 Bulk Excel Import

---

## 📦 Requirements

* Node.js 18+
* npm 9+
* Git

---

## 🚀 Quick Start

```bash
git clone <repository-url>
cd Barkat_vo-main

npm install
npm run dev
```

---

## 📜 Scripts

```bash
npm run dev          # Development
npm run build        # Production build
npm run build:win    # Windows installer
npm run build:mac    # macOS build
npm run build:linux  # Linux build
npm run lint         # ESLint
npm run typecheck    # TypeScript check
npm test             # Run tests
```

---

## 📁 Project Structure

```
src/
├── main/        # Electron backend
├── preload/     # IPC bridge
└── renderer/    # React frontend
```

---

## 📥 Import Data

Use **Import Standard Workbook** from the **Projects** page.

Workbook must contain:

* **Project** – Society details
* **Units** – Owner & unit information
* **Ledger** – Maintenance records

The importer updates existing records automatically without creating duplicates.

---

## 📝 Manual Workflow

1. Create Project
2. Configure Maintenance Rates
3. Add or Import Units
4. Generate Maintenance Letters
5. Record Payments
6. View Reports

---

## 🏗️ Production Build

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

Build files are generated inside the **dist/** directory.

---

## 🗄️ Database

SQLite (`better-sqlite3`) is used for local storage.

Main tables:

* projects
* units
* maintenance_letters
* payments
* maintenance_rates
* add_ons
* settings

---

## 🔧 Troubleshooting

* Run `npm run postinstall` if native modules fail.
* Ensure maintenance rates exist before generating bills.
* Verify imported workbook sheet names are correct.
* Use **Settings → Check & Repair Database** to fix database issues.

---

## 📄 License

Internal project for **Barkat Property Maintenance Management**.
