export const schema = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT UNIQUE,
  name TEXT NOT NULL,
  location TEXT, -- Aligned with ER
  total_units INTEGER, -- Aligned with ER
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  -- UI uses Active/Inactive; older versions used Sold/Unsold.
  status TEXT DEFAULT 'Sold' CHECK(status IN ('Sold', 'Unsold', 'Active', 'Inactive')),
  letterhead_path TEXT,
  account_name TEXT,
  bank_name TEXT,
  account_no TEXT,
  ifsc_code TEXT,
  branch TEXT,
  branch_address TEXT,
  qr_code_path TEXT,
  template_type TEXT DEFAULT 'standard',
  payment_modes TEXT DEFAULT 'Cheque/Cash/Online Transfer', -- Dynamic payment modes
  contact_email TEXT,   -- Society contact email shown on PDF letterhead
  contact_phone TEXT,   -- Society contact phone shown on PDF letterhead
  import_profile_key TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  unit_number TEXT NOT NULL,
  sector_code TEXT, -- Sector/Block code (e.g. A, B, C, 1, 2)
  unit_type TEXT DEFAULT 'Bungalow' CHECK(unit_type IN ('Bungalow', 'Plot', 'Garden')), -- Plot, Bungalow
  area_sqft REAL NOT NULL CHECK(area_sqft > 0),
  owner_name TEXT NOT NULL,
  contact_number TEXT,
  email TEXT,
  billing_address TEXT,
  resident_address TEXT,
  penalty REAL DEFAULT 0 CHECK(penalty >= 0),
  penalty_percentage REAL DEFAULT NULL CHECK(penalty_percentage IS NULL OR (penalty_percentage BETWEEN 0 AND 100)),
  status TEXT DEFAULT 'Sold' CHECK(status IN ('Sold', 'Unsold', 'Vacant')), -- Sold, Unsold, Vacant
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, unit_number) ON CONFLICT REPLACE
);

CREATE TABLE IF NOT EXISTS project_sector_payment_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  sector_code TEXT NOT NULL,
  account_name TEXT,
  bank_name TEXT,
  account_no TEXT,
  ifsc_code TEXT,
  branch TEXT,
  qr_code_path TEXT,
  letterhead_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, sector_code)
);

CREATE TABLE IF NOT EXISTS project_addon_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  addon_name TEXT NOT NULL,
  addon_type TEXT NOT NULL CHECK(addon_type IN ('fixed', 'rate_per_sqft')),
  amount REAL NOT NULL CHECK(amount >= 0),
  is_enabled BOOLEAN DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_charges_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  na_tax_rate_per_sqft REAL DEFAULT 0.09 CHECK(na_tax_rate_per_sqft >= 0),
  solar_contribution REAL DEFAULT 3000 CHECK(solar_contribution >= 0),
  cable_charges REAL DEFAULT 1000 CHECK(cable_charges >= 0),
  penalty_percentage REAL DEFAULT 21 CHECK(penalty_percentage BETWEEN 0 AND 100),
  penalty_label TEXT DEFAULT 'Penalty' CHECK(penalty_label IN ('Penalty', 'Late Payment Charges')),
  early_payment_discount_percentage REAL DEFAULT 10 CHECK(early_payment_discount_percentage BETWEEN 0 AND 100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS maintenance_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  financial_year TEXT NOT NULL, -- e.g. 2024-25
  unit_type TEXT DEFAULT 'Bungalow' CHECK(unit_type IN ('Bungalow', 'Plot', 'Garden', 'All')), -- Aligned with ER
  rate_per_sqft REAL NOT NULL CHECK(rate_per_sqft > 0),
  gst_percent REAL DEFAULT 0 CHECK(gst_percent >= 0),   -- e.g. 18 for 18% GST
  penalty_percentage REAL DEFAULT NULL CHECK(penalty_percentage IS NULL OR (penalty_percentage BETWEEN 0 AND 100)),
  billing_frequency TEXT DEFAULT 'YEARLY',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS maintenance_slabs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rate_id INTEGER NOT NULL,
  due_date DATE NOT NULL,
  discount_percentage REAL DEFAULT 0 CHECK(discount_percentage BETWEEN 0 AND 100),
  is_early_payment BOOLEAN DEFAULT 0,
  FOREIGN KEY (rate_id) REFERENCES maintenance_rates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS maintenance_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  financial_year TEXT NOT NULL,
  base_amount REAL NOT NULL, -- Maps to maintenance_charge
  arrears REAL DEFAULT 0, -- Aligned with ER
  snapshot_discount_percentage REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  final_amount REAL NOT NULL,
  is_paid BOOLEAN DEFAULT 0, -- Aligned with ER
  is_sent BOOLEAN DEFAULT 0, -- Aligned with ER
  due_date DATE,
  snapshot_account_name TEXT,
  snapshot_bank_name TEXT,
  snapshot_account_no TEXT,
  snapshot_ifsc_code TEXT,
  snapshot_branch TEXT,
  snapshot_branch_address TEXT,
  snapshot_qr_code_path TEXT,
  snapshot_uses_sector_config BOOLEAN DEFAULT 0,
  status TEXT DEFAULT 'Generated' CHECK(status IN ('Generated', 'Modified', 'Pending', 'Paid')), -- Generated, Modified, Pending, Paid
  pdf_path TEXT,
  generated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
  UNIQUE(unit_id, financial_year) -- Enforce 1 row = 1 unit + 1 year
);

CREATE TABLE IF NOT EXISTS add_ons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  letter_id INTEGER NOT NULL,
  addon_name TEXT NOT NULL, -- Maps to name
  addon_amount REAL NOT NULL, -- Maps to amount
  remarks TEXT,
  FOREIGN KEY (letter_id) REFERENCES maintenance_letters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  letter_id INTEGER,
  payment_date DATE NOT NULL,
  payment_amount REAL NOT NULL CHECK(payment_amount > 0),
  financial_year TEXT NOT NULL, -- Attribution for reports (required)
  payment_mode TEXT NOT NULL CHECK(payment_mode IN ('Cash', 'Cheque', 'UPI', 'Transfer')), -- Cash, Cheque, UPI, Transfer
  reference_number TEXT, -- Aligned with ER
  cheque_number TEXT,
  remarks TEXT,
  payment_status TEXT DEFAULT 'Received' CHECK(payment_status IN ('Received', 'Pending')), -- Received, Pending
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
  FOREIGN KEY (letter_id) REFERENCES maintenance_letters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL,
  receipt_number TEXT UNIQUE,
  receipt_date DATE NOT NULL,
  snapshot_letter_id INTEGER,
  snapshot_financial_year TEXT,
  snapshot_base_amount REAL DEFAULT 0,
  snapshot_arrears REAL DEFAULT 0,
  snapshot_discount_amount REAL DEFAULT 0,
  snapshot_letter_total REAL DEFAULT 0,
  snapshot_addons_json TEXT,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS excel_import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  file_name TEXT,
  import_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT, -- Success, Partial, Failed
  remarks TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`
