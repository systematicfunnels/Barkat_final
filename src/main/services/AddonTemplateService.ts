import { dbService } from '../db/database'

export interface ProjectAddonTemplate {
  id?: number
  project_id: number
  addon_name: string
  addon_type: 'fixed' | 'rate_per_sqft'
  amount: number
  is_enabled: boolean
  sort_order: number
  created_at?: string
  updated_at?: string
}

export class AddonTemplateService {
  /**
   * Get all addon templates for a project
   */
  public getProjectTemplates(projectId: number): ProjectAddonTemplate[] {
    return dbService.query<ProjectAddonTemplate>(
      `SELECT * FROM project_addon_templates 
       WHERE project_id = ? 
       ORDER BY sort_order ASC, addon_name ASC`,
      [projectId]
    )
  }

  /**
   * Get only enabled addon templates for a project
   */
  public getEnabledTemplates(projectId: number): ProjectAddonTemplate[] {
    return dbService.query<ProjectAddonTemplate>(
      `SELECT * FROM project_addon_templates 
       WHERE project_id = ? AND is_enabled = 1 
       ORDER BY sort_order ASC, addon_name ASC`,
      [projectId]
    )
  }

  /**
   * Create addon template
   */
  public createTemplate(template: Omit<ProjectAddonTemplate, 'id' | 'created_at' | 'updated_at'>): number {
    const result = dbService.run(
      `INSERT INTO project_addon_templates 
       (project_id, addon_name, addon_type, amount, is_enabled, sort_order) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        template.project_id,
        template.addon_name,
        template.addon_type,
        template.amount,
        template.is_enabled ? 1 : 0,
        template.sort_order
      ]
    )
    return result.lastInsertRowid as number
  }

  /**
   * Update addon template
   */
  public updateTemplate(id: number, template: Partial<ProjectAddonTemplate>): boolean {
    const updates: string[] = []
    const values: (string | number | boolean)[] = []

    if (template.addon_name !== undefined) {
      updates.push('addon_name = ?')
      values.push(template.addon_name)
    }
    if (template.addon_type !== undefined) {
      updates.push('addon_type = ?')
      values.push(template.addon_type)
    }
    if (template.amount !== undefined) {
      updates.push('amount = ?')
      values.push(template.amount)
    }
    if (template.is_enabled !== undefined) {
      updates.push('is_enabled = ?')
      values.push(template.is_enabled ? 1 : 0)
    }
    if (template.sort_order !== undefined) {
      updates.push('sort_order = ?')
      values.push(template.sort_order)
    }

    if (updates.length === 0) return false

    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    const sql = `UPDATE project_addon_templates SET ${updates.join(', ')} WHERE id = ?`
    const result = dbService.run(sql, values)
    return result.changes > 0
  }

  /**
   * Delete addon template
   */
  public deleteTemplate(id: number): boolean {
    const result = dbService.run('DELETE FROM project_addon_templates WHERE id = ?', [id])
    return result.changes > 0
  }

  /**
   * Reorder templates
   */
  public reorderTemplates(templates: { id: number; sort_order: number }[]): boolean {
    return dbService.transaction(() => {
      for (const template of templates) {
        dbService.run(
          'UPDATE project_addon_templates SET sort_order = ? WHERE id = ?',
          [template.sort_order, template.id]
        )
      }
      return true
    })
  }

  /**
   * Initialize default templates for a project
   */
  public initializeDefaultTemplates(projectId: number): boolean {
    const existing = this.getProjectTemplates(projectId)
    if (existing.length > 0) return true // Already has templates

    const defaultTemplates = [
      { addon_name: 'N.A. Tax', addon_type: 'rate_per_sqft' as const, amount: 0.09, is_enabled: true, sort_order: 1 },
      { addon_name: 'Solar Contribution', addon_type: 'fixed' as const, amount: 3000, is_enabled: true, sort_order: 2 },
      { addon_name: 'Cable Charges', addon_type: 'fixed' as const, amount: 1000, is_enabled: true, sort_order: 3 }
    ]

    return dbService.transaction(() => {
      for (const template of defaultTemplates) {
        this.createTemplate({
          project_id: projectId,
          ...template
        })
      }
      return true
    })
  }

  /**
   * Migrate from old project_charges_config to new templates
   */
  public migrateFromChargesConfig(projectId: number): boolean {
    const existing = this.getProjectTemplates(projectId)
    if (existing.length > 0) return true // Already migrated

    // Get old charges config
    const chargesConfig = dbService.query<{
      na_tax_rate_per_sqft: number
      solar_contribution: number
      cable_charges: number
    }>('SELECT * FROM project_charges_config WHERE project_id = ?', [projectId])

    if (chargesConfig.length === 0) {
      // No old config, initialize defaults
      return this.initializeDefaultTemplates(projectId)
    }

    const config = chargesConfig[0]
    const templates = [
      { addon_name: 'N.A. Tax', addon_type: 'rate_per_sqft' as const, amount: config.na_tax_rate_per_sqft, is_enabled: true, sort_order: 1 },
      { addon_name: 'Solar Contribution', addon_type: 'fixed' as const, amount: config.solar_contribution, is_enabled: true, sort_order: 2 },
      { addon_name: 'Cable Charges', addon_type: 'fixed' as const, amount: config.cable_charges, is_enabled: true, sort_order: 3 }
    ]

    return dbService.transaction(() => {
      for (const template of templates) {
        this.createTemplate({
          project_id: projectId,
          ...template
        })
      }
      // Optionally delete old config after migration
      // dbService.run('DELETE FROM project_charges_config WHERE project_id = ?', [projectId])
      return true
    })
  }
}

export const addonTemplateService = new AddonTemplateService()
