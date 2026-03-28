import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { schema } from './schema'

class DatabaseService {
  private db: Database.Database

  private formatProjectCode(sequenceNumber: number): string {
    return `PRJ-${String(sequenceNumber).padStart(3, '0')}`
  }

  private ensureProjectCodes(): void {
    try {
      const rows = this.db
        .prepare(
          `
          SELECT id, project_code
          FROM projects
          ORDER BY id ASC
        `
        )
        .all() as { id: number; project_code: string | null }[]

      console.log(`[DATABASE] ensureProjectCodes: Found ${rows.length} projects to process`)

      const usedCodes = new Set<string>()
      let nextSequence = 1

      // First pass: collect existing codes and determine next sequence
      for (const row of rows) {
        const normalizedCode =
          typeof row.project_code === 'string' ? row.project_code.trim().toUpperCase() : ''
        if (normalizedCode) {
          usedCodes.add(normalizedCode)
          const match = normalizedCode.match(/^PRJ-(\d+)$/)
          if (match) {
            nextSequence = Math.max(nextSequence, Number(match[1]) + 1)
          }
        }
      }

      console.log(`[DATABASE] ensureProjectCodes: Found ${usedCodes.size} existing codes, next sequence: ${nextSequence}`)

      // Second pass: assign codes to projects without codes
      const updateStatement = this.db.prepare('UPDATE projects SET project_code = ? WHERE id = ?')
      let updatedCount = 0
      for (const row of rows) {
        const normalizedCode =
          typeof row.project_code === 'string' ? row.project_code.trim().toUpperCase() : ''
        if (normalizedCode) continue

        let candidate = this.formatProjectCode(nextSequence)
        while (usedCodes.has(candidate)) {
          nextSequence += 1
          candidate = this.formatProjectCode(nextSequence)
        }

        updateStatement.run(candidate, row.id)
        usedCodes.add(candidate)
        nextSequence += 1
        updatedCount += 1
        
        console.log(`[DATABASE] ensureProjectCodes: Assigned code ${candidate} to project ID ${row.id}`)
      }
      
      console.log(`[DATABASE] Project codes ensured: ${rows.length} projects processed, ${updatedCount} codes assigned`)
    } catch (error) {
      console.error('[DATABASE] Failed to ensure project codes:', error)
    }
  }

  constructor() {
    const dbPath = app.isPackaged
      ? path.join(app.getPath('userData'), 'barkat.db')
      : path.join(__dirname, '../../barkat.db')

    console.log('[DATABASE] Database path:', dbPath)
    console.log('[DATABASE] App packaged:', app.isPackaged)
    console.log('[DATABASE] User data path:', app.getPath('userData'))
    console.log('[DATABASE] __dirname:', __dirname)

    // Check if database file exists
    const dbExists = fs.existsSync(dbPath)
    console.log('[DATABASE] Database file exists:', dbExists)
    
    if (dbExists) {
      const stats = fs.statSync(dbPath)
      console.log('[DATABASE] Database file size:', stats.size, 'bytes')
      console.log('[DATABASE] Database modified:', stats.mtime)
    }

    try {
      this.db = new Database(dbPath)
      console.log('[DATABASE] Database connection established successfully')
      
      // Test basic query
      try {
        const testQuery = this.db.prepare('SELECT COUNT(*) as count FROM sqlite_master WHERE type="table"').get()
        console.log('[DATABASE] Test query result:', testQuery)
      } catch (testError) {
        console.error('[DATABASE] Test query failed:', testError)
      }
      
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)

      // If the installed app has a corrupted sqlite file, recover automatically by recreating it.
      // This prevents the “database disk image is malformed” crash during setup/import.
      if (app.isPackaged && /malformed|corrupt|not a database/i.test(message)) {
        try {
          const backupPath = `${dbPath}.corrupt.${Date.now()}`
          if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, backupPath)
            fs.unlinkSync(dbPath)
          }

          // Cleanup WAL/SHM sidecars if they exist.
          for (const suffix of ['-wal', '-shm']) {
            const sidecar = `${dbPath}${suffix}`
            if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar)
          }

          this.db = new Database(dbPath)
          console.warn(
            '[DATABASE] Corrupted sqlite db detected; backed up and recreated:',
            backupPath
          )
        } catch (recoveryError: unknown) {
          const recoveryMessage =
            recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
          console.error('[DATABASE] Failed to recover from corrupted db:', recoveryMessage)
          throw error
        }
      } else {
        throw error
      }
    }

    // Register REGEXP function for SQLite
    // SQLite calls: `expr REGEXP pattern` => regexp(expr, pattern)
    // So function signature must be (value, pattern).
    this.db.function('regexp', (value: string, pattern: string) => {
      try {
        const regex = new RegExp(pattern)
        return regex.test(value) ? 1 : 0
      } catch {
        return 0
      }
    })
    this.db.pragma('journal_mode = WAL')

    // Step 1: Disable foreign keys during initialization and migration
    this.db.pragma('foreign_keys = OFF')

    this.init()

    // Step 2: Clean up any leftover _old tables from previous failed runs/migrations
    // this.cleanupOldTables()

    // Step 3: Check for and fix broken foreign key references
    this.fixBrokenForeignKeys()

    // Step 4: Re-enable foreign keys after all migrations are complete
    this.db.pragma('foreign_keys = ON')

    // Fix any maintenance_letters with NULL/empty/invalid due_date by defaulting to generated_date + 30 days
    try {
      const invalidLetters = this.db.prepare(`
        SELECT id, generated_date
        FROM maintenance_letters
        WHERE due_date IS NULL OR TRIM(due_date) = '' OR due_date = 'Invalid Date'
      `).all() as { id: number; generated_date: string }[]

      if (invalidLetters.length > 0) {
        for (const letter of invalidLetters) {
          const base = new Date(letter.generated_date || new Date())
          base.setDate(base.getDate() + 30)
          this.db.prepare('UPDATE maintenance_letters SET due_date = ? WHERE id = ?')
            .run(base.toISOString().split('T')[0], letter.id)
        }
        console.log(`[DATABASE] Fixed ${invalidLetters.length} maintenance letters with missing due_date`)
      }
    } catch (error) {
      console.error('[DATABASE] Failed to fix due dates:', error)
    }

    // Diagnostic check
    const violations = this.db.pragma('foreign_key_check') as unknown[]
    if (violations && violations.length > 0) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(
          '[DATABASE] Foreign key violations detected after initialization:',
          JSON.stringify(violations, null, 2)
        )
      } else {
        console.error('[DATABASE] Data integrity issues detected during startup')
      }
    }
  }

  public cleanupOldTables(): void {
    try {
      const tables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_old'")
        .all() as { name: string }[]
      for (const table of tables) {
        console.log(`[DATABASE] Dropping leftover table: ${table.name}`)
        this.db.exec(`DROP TABLE IF EXISTS ${table.name}`)
      }
    } catch (e) {
      console.error('[DATABASE] Error cleaning up old tables:', e)
    }
  }

  public fixBrokenForeignKeys(): void {
    try {
      // List of all tables in dependency order (top-down)
      const allTables = [
        'projects',
        'project_sector_payment_configs',
        'units',
        'maintenance_rates',
        'maintenance_slabs',
        'maintenance_letters',
        'add_ons',
        'payments',
        'receipts',
        'excel_import_log',
        'settings'
      ]

      let needsRebuild = false
      const tablesWithOldReferences: string[] = []

      for (const tableName of allTables) {
        const tableInfo = this.db
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
          .get(tableName) as { sql: string } | undefined
        if (tableInfo) {
          const sql = tableInfo.sql.toLowerCase()
          console.log(`[DATABASE] Checking table ${tableName} schema: ${sql.substring(0, 100)}...`)
          // Check for any references to "_old" tables or the old "societies" name
          if (
            sql.includes('references societies') ||
            sql.includes('references "societies"') ||
            sql.includes('references `societies`') ||
            sql.includes('_old')
          ) {
            console.warn(`[DATABASE] Table ${tableName} has broken references: ${sql}`)
            needsRebuild = true
            tablesWithOldReferences.push(tableName)
          }
        }
      }

      if (needsRebuild) {
        console.warn(
          `[DATABASE] Detected broken foreign key references in tables: ${tablesWithOldReferences.join(', ')}. Performing a full schema rebuild...`
        )

        // Step 2a: Disable foreign keys BEFORE rebuilding
        this.db.pragma('foreign_keys = OFF')

        this.transaction(() => {
          // 1. Rename all existing tables to _old
          for (const tableName of allTables) {
            const tableExists = this.db
              .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
              .get(tableName)
            if (tableExists) {
              this.db.exec(`DROP TABLE IF EXISTS ${tableName}_old`)
              this.db.exec(`ALTER TABLE ${tableName} RENAME TO ${tableName}_old`)
            }
          }

          // 2. Create fresh tables from schema
          this.db.exec(schema)

          // 3. Copy data back for each table
          for (const tableName of allTables) {
            const oldTableExists = this.db
              .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
              .get(`${tableName}_old`)
            if (oldTableExists) {
              try {
                // Get columns that exist in both old and new tables
                const newColumns = (
                  this.db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]
                ).map((c) => c.name)
                const oldColumns = (
                  this.db.prepare(`PRAGMA table_info(${tableName}_old)`).all() as { name: string }[]
                ).map((c) => c.name)
                const commonColumns = newColumns.filter((c) => oldColumns.includes(c))

                if (commonColumns.length > 0) {
                  const colList = commonColumns.join(', ')
                  this.db.exec(
                    `INSERT INTO ${tableName} (${colList}) SELECT ${colList} FROM ${tableName}_old`
                  )
                  console.log(`[DATABASE] Restored data for ${tableName}`)
                }
              } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e)
                console.error(`[DATABASE] Failed to restore data for ${tableName}:`, message)
              }
            }
          }

          // 4. Drop all _old tables
          for (const tableName of allTables) {
            this.db.exec(`DROP TABLE IF EXISTS ${tableName}_old`)
          }
        })

        // Step 2b: Re-enable foreign keys AFTER rebuilding
        this.db.pragma('foreign_keys = ON')

        console.log('[DATABASE] Full schema rebuild completed successfully.')
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[DATABASE] Error during schema rebuild:', message)
    }
  }

  public cleanupOrphanData(): void {
    try {
      this.transaction(() => {
        // 1. Delete maintenance letters without valid units or projects
        this.db.exec(`
          DELETE FROM maintenance_letters 
          WHERE unit_id NOT IN (SELECT id FROM units)
          OR project_id NOT IN (SELECT id FROM projects)
        `)

        // 2. Delete add-ons without valid letters
        this.db.exec(`
          DELETE FROM add_ons 
          WHERE letter_id NOT IN (SELECT id FROM maintenance_letters)
        `)

        // 3. Delete payments without valid units or projects
        this.db.exec(`
          DELETE FROM payments 
          WHERE unit_id NOT IN (SELECT id FROM units)
          OR project_id NOT IN (SELECT id FROM projects)
        `)

        // 4. Delete sector payment configs without valid project
        this.db.exec(`
          DELETE FROM project_sector_payment_configs
          WHERE project_id NOT IN (SELECT id FROM projects)
        `)

        // 5. Clean up unit project_id references (the root cause of many FK issues)
        this.db.exec(`
          DELETE FROM units 
          WHERE project_id NOT IN (SELECT id FROM projects)
        `)
      })
      console.log('[DATABASE] Orphan data cleanup completed')
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[DATABASE] Error cleaning orphan data:', message)
    }
  }

  private init(): void {
    this.migrate()
    this.db.exec(schema)
    
    // Apply any additional migrations after schema creation
    this.applyMigrations()

    console.log('Database initialized')
  }

  private applyMigrations(): void {
    try {
      // Normalize project status legacy values
      console.log('[DATABASE] Migrating legacy project status values...')
      this.db.exec(`
        UPDATE projects SET status = 'Active' WHERE status IN ('Sold', 'sold');
        UPDATE projects SET status = 'Inactive' WHERE status IN ('Unsold', 'unsold');
      `)
      console.log('[DATABASE] Project status migration completed')

      // Check if payment_modes column exists
      const columns = this.db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
      const hasPaymentModes = columns.some((c) => c.name === 'payment_modes')
      
      if (!hasPaymentModes) {
        console.log('[DATABASE] Adding payment_modes column to projects table...')
        this.db.exec('ALTER TABLE projects ADD COLUMN payment_modes TEXT DEFAULT "Cheque/Cash/Online Transfer"')
        console.log('[DATABASE] payment_modes column added successfully')
      }

      if (!columns.some((c) => c.name === 'letterhead_path')) {
        this.db.exec('ALTER TABLE projects ADD COLUMN letterhead_path TEXT')
        console.log('[DATABASE] letterhead_path column added to projects')
      }
      if (!columns.some((c) => c.name === 'qr_code_path')) {
        this.db.exec('ALTER TABLE projects ADD COLUMN qr_code_path TEXT')
        console.log('[DATABASE] qr_code_path column added to projects')
      }
      // Add contact_email and contact_phone if missing (used on PDF letterhead)
      if (!columns.some((c) => c.name === 'contact_email')) {
        this.db.exec('ALTER TABLE projects ADD COLUMN contact_email TEXT')
        console.log('[DATABASE] contact_email column added to projects')
      }
      if (!columns.some((c) => c.name === 'contact_phone')) {
        this.db.exec('ALTER TABLE projects ADD COLUMN contact_phone TEXT')
        console.log('[DATABASE] contact_phone column added to projects')
      }

      // Migrate sector_payment_configs — add full bank detail columns if missing
      const sectorCols = this.db.prepare('PRAGMA table_info(project_sector_payment_configs)').all() as { name: string }[]
      const sectorColNames = sectorCols.map(c => c.name)
      const sectorBankCols = [
        'account_name',
        'bank_name',
        'account_no',
        'ifsc_code',
        'branch',
        'qr_code_path'
      ]
      for (const col of sectorBankCols) {
        if (!sectorColNames.includes(col)) {
          this.db.exec(`ALTER TABLE project_sector_payment_configs ADD COLUMN ${col} TEXT`)
          console.log(`[DATABASE] ${col} column added to project_sector_payment_configs`)
        }
      }

      // Relax unit_type CHECK to allow Garden and BMF (for Banjara Hills)
      // SQLite doesn't support ALTER COLUMN, so we only need to handle future inserts
      // The schema CREATE TABLE already has the wider CHECK, migration handles existing db via rebuild if needed

      // Add gst_percent to maintenance_rates if missing
      const ratesCols = this.db.prepare('PRAGMA table_info(maintenance_rates)').all() as { name: string }[]
      if (!ratesCols.some((c) => c.name === 'gst_percent')) {
        this.db.exec('ALTER TABLE maintenance_rates ADD COLUMN gst_percent REAL DEFAULT 0')
        console.log('[DATABASE] gst_percent column added to maintenance_rates')
      }

      // Ensure project_addon_templates table exists (new in this version)
      this.db.exec(`
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
        )
      `)

      // Remove REGEXP CHECK constraint from payments table (SQLite doesn't support REGEXP natively)
      try {
        const paymentsTableInfo = this.db.prepare('PRAGMA table_info(payments)').all() as { name: string }[]
        if (paymentsTableInfo.length > 0) {
          // Check if the table has the old REGEXP constraint by trying to create a test record
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS payments_test (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_id INTEGER NOT NULL,
              unit_id INTEGER NOT NULL,
              letter_id INTEGER,
              payment_date DATE NOT NULL,
              payment_amount REAL NOT NULL CHECK(payment_amount > 0),
              financial_year TEXT NOT NULL,
              payment_mode TEXT NOT NULL CHECK(payment_mode IN ('Cash', 'Cheque', 'UPI', 'Transfer')),
              reference_number TEXT,
              cheque_number TEXT,
              remarks TEXT,
              payment_status TEXT DEFAULT 'Received' CHECK(payment_status IN ('Received', 'Pending')),
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
              FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
              FOREIGN KEY (letter_id) REFERENCES maintenance_letters(id) ON DELETE CASCADE
            )
          `)
          
          if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payments_test'").get()) {
            // Backup existing data
            this.db.exec(`
              CREATE TABLE IF NOT EXISTS payments_backup AS SELECT * FROM payments
            `)
            
            // Drop the old table
            this.db.exec('DROP TABLE payments')
            
            // Rename the test table to payments
            this.db.exec('ALTER TABLE payments_test RENAME TO payments')
            
            // Restore data
            this.db.exec(`
              INSERT INTO payments SELECT * FROM payments_backup
            `)
            
            // Clean up backup
            this.db.exec('DROP TABLE payments_backup')
            
            console.log('[DATABASE] Successfully removed REGEXP constraint from payments table')
          }
        }
      } catch (error) {
        console.log('[DATABASE] Could not migrate payments table (may already be updated):', error instanceof Error ? error.message : error)
      }

      // Remove REGEXP CHECK constraint from maintenance_rates table as well
      try {
        const ratesTableInfo = this.db.prepare('PRAGMA table_info(maintenance_rates)').all() as { name: string }[]
        if (ratesTableInfo.length > 0) {
          // Create test table without REGEXP constraint
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS maintenance_rates_test (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_id INTEGER NOT NULL,
              financial_year TEXT NOT NULL,
              unit_type TEXT DEFAULT 'Bungalow' CHECK(unit_type IN ('Bungalow', 'Plot', 'Garden', 'BMF', 'All')),
              rate_per_sqft REAL NOT NULL CHECK(rate_per_sqft > 0),
              gst_percent REAL DEFAULT 0 CHECK(gst_percent >= 0),
              billing_frequency TEXT DEFAULT 'YEARLY',
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
          `)
          
          if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maintenance_rates_test'").get()) {
            // Backup existing data
            this.db.exec(`
              CREATE TABLE IF NOT EXISTS maintenance_rates_backup AS SELECT * FROM maintenance_rates
            `)
            
            // Drop the old table
            this.db.exec('DROP TABLE maintenance_rates')
            
            // Rename the test table to maintenance_rates
            this.db.exec('ALTER TABLE maintenance_rates_test RENAME TO maintenance_rates')
            
            // Restore data
            this.db.exec(`
              INSERT INTO maintenance_rates SELECT * FROM maintenance_rates_backup
            `)
            
            // Clean up backup
            this.db.exec('DROP TABLE maintenance_rates_backup')
            
            console.log('[DATABASE] Successfully removed REGEXP constraint from maintenance_rates table')
          }
        }
      } catch (error) {
        console.log('[DATABASE] Could not migrate maintenance_rates table (may already be updated):', error instanceof Error ? error.message : error)
      }

      // Ensure project_charges_config table exists
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS project_charges_config (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL UNIQUE,
          na_tax_rate_per_sqft REAL DEFAULT 0.09,
          solar_contribution REAL DEFAULT 0,
          cable_charges REAL DEFAULT 0,
          penalty_percentage REAL DEFAULT 0,
          early_payment_discount_percentage REAL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `)

      // Ensure projects.status CHECK constraint allows Active/Inactive.
      // Older DBs may have CHECK(status IN ('Sold','Unsold')) which rejects UI values.
      const projectsSql = this.db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'")
        .get() as { sql?: string } | undefined

      const projectsSchemaSqlRaw = projectsSql?.sql || ''
      const projectsSchemaSql = projectsSchemaSqlRaw.toLowerCase()

      // Make detection tolerant of whitespace/format differences.
      // Example SQLite output varies by spaces after commas/keywords.
      const compact = projectsSchemaSql.replace(/\s+/g, '')
      const hasSoldUnsoldCheck =
        compact.includes('check') &&
        compact.includes('status') &&
        compact.includes("'sold'") &&
        compact.includes("'unsold'")

      const needsStatusConstraintRebuild =
        hasSoldUnsoldCheck && !projectsSchemaSql.includes('active') && !projectsSchemaSql.includes('inactive')

      if (needsStatusConstraintRebuild) {
        console.warn('[DATABASE] Rebuilding projects table to relax status CHECK constraint...')

        // Rebuild only the projects table with relaxed CHECK.
        // This preserves data by copying common columns.
        this.transaction(() => {
          // Rename old table
          this.db.exec('ALTER TABLE projects RENAME TO projects_old')

          // Create new table with relaxed constraint (same columns as schema.ts projects table)
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS projects (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_code TEXT UNIQUE,
              name TEXT NOT NULL,
              location TEXT,
              total_units INTEGER,
              address TEXT,
              city TEXT,
              state TEXT,
              pincode TEXT,
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
              payment_modes TEXT DEFAULT 'Cheque/Cash/Online Transfer',
              contact_email TEXT,
              contact_phone TEXT,
              import_profile_key TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
          `)

          // Copy overlapping columns back
          const newCols = (this.db.prepare('PRAGMA table_info(projects)').all() as { name: string }[])
            .map((c) => c.name)
          const oldCols = (this.db.prepare('PRAGMA table_info(projects_old)').all() as { name: string }[])
            .map((c) => c.name)
          const commonCols = newCols.filter((c) => oldCols.includes(c))
          if (commonCols.length > 0) {
            const colList = commonCols.join(', ')
            this.db.exec(
              `INSERT INTO projects (${colList}) SELECT ${colList} FROM projects_old`
            )
          }

          this.db.exec('DROP TABLE IF EXISTS projects_old')
        })
      }
    } catch (error) {
      console.error('[DATABASE] Migration failed:', error)
      throw error
    }
  }

  private migrate(): void {
    try {
      // 1. Check if we need to migrate 'societies' table to 'projects'
      const societiesExist = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='societies'")
        .get()
      const projectsExist = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
        .get()

      if (societiesExist && !projectsExist) {
        console.log('Renaming societies table to projects...')
        this.db.exec('ALTER TABLE societies RENAME TO projects')
      }

      // 2. Ensure projects table has new columns
      if (
        this.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
          .get()
      ) {
        const columns = this.db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
        if (!columns.some((c) => c.name === 'location'))
          this.db.exec('ALTER TABLE projects ADD COLUMN location TEXT')
        if (!columns.some((c) => c.name === 'total_units'))
          this.db.exec('ALTER TABLE projects ADD COLUMN total_units INTEGER')
        if (!columns.some((c) => c.name === 'address'))
          this.db.exec('ALTER TABLE projects ADD COLUMN address TEXT')
        if (!columns.some((c) => c.name === 'city'))
          this.db.exec('ALTER TABLE projects ADD COLUMN city TEXT')
        if (!columns.some((c) => c.name === 'state'))
          this.db.exec('ALTER TABLE projects ADD COLUMN state TEXT')
        if (!columns.some((c) => c.name === 'pincode'))
          this.db.exec('ALTER TABLE projects ADD COLUMN pincode TEXT')
        if (!columns.some((c) => c.name === 'status'))
          this.db.exec("ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'Sold'")
        if (!columns.some((c) => c.name === 'account_name'))
          this.db.exec('ALTER TABLE projects ADD COLUMN account_name TEXT')
        if (!columns.some((c) => c.name === 'branch'))
          this.db.exec('ALTER TABLE projects ADD COLUMN branch TEXT')
        if (!columns.some((c) => c.name === 'branch_address'))
          this.db.exec('ALTER TABLE projects ADD COLUMN branch_address TEXT')
        if (!columns.some((c) => c.name === 'project_code'))
          this.db.exec('ALTER TABLE projects ADD COLUMN project_code TEXT')
        if (!columns.some((c) => c.name === 'template_type'))
          this.db.exec("ALTER TABLE projects ADD COLUMN template_type TEXT DEFAULT 'standard'")
        if (!columns.some((c) => c.name === 'import_profile_key'))
          this.db.exec('ALTER TABLE projects ADD COLUMN import_profile_key TEXT')
        this.ensureProjectCodes()
        this.db.exec(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_project_code ON projects(project_code)'
        )
      }

      // 2.1 Ensure maintenance_rates table has new columns
      if (
        this.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maintenance_rates'")
          .get()
      ) {
        const columns = this.db.prepare('PRAGMA table_info(maintenance_rates)').all() as {
          name: string
        }[]
        if (!columns.some((c) => c.name === 'unit_type'))
          this.db.exec("ALTER TABLE maintenance_rates ADD COLUMN unit_type TEXT DEFAULT 'Bungalow'")

        // Normalize legacy values to supported unit types.
        this.db.exec(`
          UPDATE maintenance_rates
          SET unit_type = CASE
            WHEN unit_type IS NULL OR TRIM(unit_type) = '' THEN 'Bungalow'
            WHEN LOWER(TRIM(unit_type)) = 'flat' THEN 'Bungalow'
            WHEN LOWER(TRIM(unit_type)) = 'plot' THEN 'Plot'
            WHEN LOWER(TRIM(unit_type)) IN ('all', 'all units') THEN 'All'
            WHEN LOWER(TRIM(unit_type)) = 'bungalow' THEN 'Bungalow'
            ELSE unit_type
          END
        `)
      }

      // 2.2 Ensure maintenance_letters table has new columns
      if (
        this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='maintenance_letters'"
          )
          .get()
      ) {
        const columns = this.db.prepare('PRAGMA table_info(maintenance_letters)').all() as {
          name: string
        }[]
        if (!columns.some((c) => c.name === 'arrears'))
          this.db.exec('ALTER TABLE maintenance_letters ADD COLUMN arrears REAL DEFAULT 0')
        if (!columns.some((c) => c.name === 'is_paid'))
          this.db.exec('ALTER TABLE maintenance_letters ADD COLUMN is_paid BOOLEAN DEFAULT 0')
        if (!columns.some((c) => c.name === 'is_sent'))
          this.db.exec('ALTER TABLE maintenance_letters ADD COLUMN is_sent BOOLEAN DEFAULT 0')

        // Add unique index for granularity enforcement
        this.db.exec(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_fy ON maintenance_letters(unit_id, financial_year)'
        )
      }

      // 3. Migrate 'units' table
      const unitsExist = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='units'")
        .get()
      if (unitsExist) {
        const columns = this.db.prepare('PRAGMA table_info(units)').all() as { name: string }[]
        const hasProjectId = columns.some((c) => c.name === 'project_id')
        const hasSocietyId = columns.some((c) => c.name === 'society_id')

        if (hasSocietyId && !hasProjectId) {
          console.log('Renaming society_id column to project_id in units table...')
          try {
            this.db.exec('ALTER TABLE units RENAME COLUMN society_id TO project_id')
          } catch {
            this.db.exec(`
              ALTER TABLE units ADD COLUMN project_id INTEGER;
              UPDATE units SET project_id = society_id;
            `)
          }
        }

        if (!columns.some((c) => c.name === 'unit_type'))
          this.db.exec("ALTER TABLE units ADD COLUMN unit_type TEXT DEFAULT 'Bungalow'")
        if (!columns.some((c) => c.name === 'sector_code'))
          this.db.exec('ALTER TABLE units ADD COLUMN sector_code TEXT')
        if (!columns.some((c) => c.name === 'status'))
          this.db.exec("ALTER TABLE units ADD COLUMN status TEXT DEFAULT 'Sold'")
        if (!columns.some((c) => c.name === 'penalty'))
          this.db.exec('ALTER TABLE units ADD COLUMN penalty REAL DEFAULT 0')
        if (!columns.some((c) => c.name === 'billing_address'))
          this.db.exec('ALTER TABLE units ADD COLUMN billing_address TEXT')
        if (!columns.some((c) => c.name === 'resident_address'))
          this.db.exec('ALTER TABLE units ADD COLUMN resident_address TEXT')

        // Backfill sector code from unit number patterns like "A-101" / "B/202".
        this.db.exec(`
          UPDATE units
          SET sector_code = UPPER(
            TRIM(
              CASE
                WHEN INSTR(TRIM(COALESCE(unit_number, '')), '-') > 0 THEN
                  SUBSTR(TRIM(unit_number), 1, INSTR(TRIM(unit_number), '-') - 1)
                WHEN INSTR(TRIM(COALESCE(unit_number, '')), '/') > 0 THEN
                  SUBSTR(TRIM(unit_number), 1, INSTR(TRIM(unit_number), '/') - 1)
                ELSE COALESCE(sector_code, '')
              END
            )
          )
          WHERE (sector_code IS NULL OR TRIM(sector_code) = '')
            AND (
              INSTR(TRIM(COALESCE(unit_number, '')), '-') > 0
              OR INSTR(TRIM(COALESCE(unit_number, '')), '/') > 0
            )
        `)

        this.db.exec(`
          UPDATE units
          SET sector_code = UPPER(TRIM(sector_code))
          WHERE sector_code IS NOT NULL AND TRIM(sector_code) <> ''
        `)
      }

      // 4. Migrate 'payments' table
      const paymentsExist = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payments'")
        .get()
      if (paymentsExist) {
        const columns = this.db.prepare('PRAGMA table_info(payments)').all() as { name: string }[]
        if (!columns.some((c) => c.name === 'reference_number'))
          this.db.exec('ALTER TABLE payments ADD COLUMN reference_number TEXT')
        if (!columns.some((c) => c.name === 'financial_year')) {
          this.db.exec('ALTER TABLE payments ADD COLUMN financial_year TEXT')
          // Try to backfill from maintenance_letters if linked
          this.db.exec(`
            UPDATE payments 
            SET financial_year = (SELECT financial_year FROM maintenance_letters WHERE id = payments.letter_id)
            WHERE letter_id IS NOT NULL
          `)
        }
      }

      // 5. Migrate 'invoices' to 'maintenance_letters'
      const invoicesExist = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'")
        .get()
      const lettersExist = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maintenance_letters'")
        .get()

      if (invoicesExist && !lettersExist) {
        console.log('Migrating invoices to maintenance_letters...')
        this.transaction(() => {
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS maintenance_letters (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_id INTEGER NOT NULL,
              unit_id INTEGER NOT NULL,
              financial_year TEXT NOT NULL,
              base_amount REAL NOT NULL,
              discount_amount REAL DEFAULT 0,
              final_amount REAL NOT NULL,
              due_date DATE,
              status TEXT DEFAULT 'Generated',
              pdf_path TEXT,
              generated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
              FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
            )
          `)

          this.db.exec(`
            INSERT OR IGNORE INTO maintenance_letters (id, project_id, unit_id, financial_year, base_amount, discount_amount, final_amount, due_date, status, pdf_path, generated_date)
            SELECT i.id, u.project_id, i.unit_id, (i.billing_year || '-' || SUBSTR((i.billing_year + 1), 3, 2)), i.amount_due, i.discount_amount, i.total_amount, i.due_date, 
                   CASE WHEN i.status = 'Paid' THEN 'Paid' ELSE 'Pending' END, i.pdf_path, i.created_at
            FROM invoices i
            JOIN units u ON i.unit_id = u.id
          `)

          // Migrate add-ons from extra_charges
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS add_ons (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              letter_id INTEGER NOT NULL,
              addon_name TEXT NOT NULL,
              addon_amount REAL NOT NULL,
              remarks TEXT,
              FOREIGN KEY (letter_id) REFERENCES maintenance_letters(id) ON DELETE CASCADE
            )
          `)

          this.db.exec(`
            INSERT OR IGNORE INTO add_ons (letter_id, addon_name, addon_amount, remarks)
            SELECT id, COALESCE(extra_charges_desc, 'Extra Charges'), extra_charges, 'Migrated from invoices'
            FROM invoices
            WHERE extra_charges > 0
          `)

          this.db.exec('DROP TABLE invoices')
        })
      }

      // 5. Migrate 'payments'
      const paymentsExistCheck = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payments'")
        .get()
      if (paymentsExistCheck) {
        const columns = this.db.prepare('PRAGMA table_info(payments)').all() as { name: string }[]

        // If it's the old structure, migrate it
        if (columns.some((c) => c.name === 'amount_paid')) {
          console.log('Migrating payments table...')
          this.transaction(() => {
            // Drop payments_new if it already exists from a failed attempt
            this.db.exec('DROP TABLE IF EXISTS payments_new')

            this.db.exec(`
              CREATE TABLE payments_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                unit_id INTEGER NOT NULL,
                letter_id INTEGER,
                payment_date DATE NOT NULL,
                payment_amount REAL NOT NULL,
                payment_mode TEXT NOT NULL,
                cheque_number TEXT,
                remarks TEXT,
                payment_status TEXT DEFAULT 'Received',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
                FOREIGN KEY (letter_id) REFERENCES maintenance_letters(id) ON DELETE SET NULL
              )
            `)

            this.db.exec(`
              INSERT INTO payments_new (id, project_id, unit_id, letter_id, payment_date, payment_amount, payment_mode, cheque_number, remarks, created_at)
              SELECT p.id, u.project_id, p.unit_id, p.invoice_id, p.payment_date, p.amount_paid, p.payment_mode, p.reference_number, p.remarks, p.created_at
              FROM payments p
              JOIN units u ON p.unit_id = u.id
            `)

            // Migrate receipts - use IF NOT EXISTS
            this.db.exec(`
              CREATE TABLE IF NOT EXISTS receipts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payment_id INTEGER NOT NULL,
                receipt_number TEXT UNIQUE,
                receipt_date DATE NOT NULL,
                FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
              )
            `)

            // Use INSERT OR IGNORE to avoid duplicate key errors
            this.db.exec(`
              INSERT OR IGNORE INTO receipts (payment_id, receipt_number, receipt_date)
              SELECT id, receipt_number, payment_date
              FROM payments
              WHERE receipt_number IS NOT NULL
            `)

            this.db.exec('DROP TABLE payments')
            this.db.exec('ALTER TABLE payments_new RENAME TO payments')
          })
        }
      }

      // 6. Ensure other new tables exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_rates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          financial_year TEXT NOT NULL,
          unit_type TEXT DEFAULT 'Bungalow',
          rate_per_sqft REAL NOT NULL,
          gst_percent REAL DEFAULT 0,
          billing_frequency TEXT DEFAULT 'YEARLY',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS maintenance_slabs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rate_id INTEGER NOT NULL,
          due_date DATE NOT NULL,
          discount_percentage REAL DEFAULT 0,
          is_early_payment BOOLEAN DEFAULT 0,
          FOREIGN KEY (rate_id) REFERENCES maintenance_rates(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS excel_import_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER,
          file_name TEXT,
          import_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT,
          remarks TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        );
      `)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[DATABASE] Migration failed:', message)
    }
  }

  public getDb(): Database.Database {
    return this.db
  }

  public query<T>(sql: string, params: unknown[] = []): T[] {
    // Proactive SQL injection prevention - warn if literals are used in WHERE/VALUES instead of placeholders
    if (params.length === 0 && !sql.includes('?')) {
      const normalized = sql.toLowerCase()
      const hasLiteralValue = /=\s*['"\d]/.test(normalized) || /in\s*\([^?]*['"\d]/.test(normalized)
      if (hasLiteralValue && (normalized.includes('where') || normalized.includes('values'))) {
        console.warn(`[DATABASE] Potential unparameterized query with literals detected: ${sql.substring(0, 100).trim()}...`)
      }
    }
    return this.db.prepare(sql).all(...params) as T[]
  }

  public get<T>(sql: string, params: unknown[] = []): T | undefined {
    // Proactive SQL injection prevention - warn if literals are used in WHERE/VALUES instead of placeholders
    if (params.length === 0 && !sql.includes('?')) {
      const normalized = sql.toLowerCase()
      const hasLiteralValue = /=\s*['"\d]/.test(normalized) || /in\s*\([^?]*['"\d]/.test(normalized)
      if (hasLiteralValue && (normalized.includes('where') || normalized.includes('values'))) {
        console.warn(`[DATABASE] Potential unparameterized query with literals detected: ${sql.substring(0, 100).trim()}...`)
      }
    }
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  public run(sql: string, params: unknown[] = []): Database.RunResult {
    // Proactive SQL injection prevention - warn if literals are used in WHERE/VALUES instead of placeholders
    if (params.length === 0 && !sql.includes('?')) {
      const normalized = sql.toLowerCase()
      const hasLiteralValue = /=\s*['"\d]/.test(normalized) || /in\s*\([^?]*['"\d]/.test(normalized)
      if (hasLiteralValue && (normalized.includes('where') || normalized.includes('values') || normalized.includes('set'))) {
        console.warn(`[DATABASE] Potential unparameterized query with literals detected: ${sql.substring(0, 100).trim()}...`)
      }
    }
    return this.db.prepare(sql).run(...params)
  }

  public transaction<T>(fn: () => T): T {
    try {
      return this.db.transaction(fn)()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      throw new Error(`Transaction failed: ${message}`)
    }
  }
}

export const dbService = new DatabaseService()
