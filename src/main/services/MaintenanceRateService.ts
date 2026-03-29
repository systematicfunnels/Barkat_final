import { dbService } from '../db/database'

export interface MaintenanceRate {
  id?: number
  project_id: number
  financial_year: string
  unit_type?: string
  rate_per_sqft: number
  gst_percent?: number
  penalty_percentage?: number
  billing_frequency?: string
  created_at?: string
  project_name?: string
}

export interface MaintenanceSlab {
  id?: number
  rate_id: number
  due_date: string
  discount_percentage: number
  is_early_payment: boolean
}

class MaintenanceRateService {
  public getAll(): MaintenanceRate[] {
    return dbService.query<MaintenanceRate>(`
      SELECT r.*, p.name as project_name
      FROM maintenance_rates r
      JOIN projects p ON r.project_id = p.id
      ORDER BY r.financial_year DESC, p.name ASC
    `)
  }

  public getByProject(projectId: number): MaintenanceRate[] {
    return dbService.query<MaintenanceRate>(
      `SELECT r.*, p.name as project_name
       FROM maintenance_rates r
       JOIN projects p ON r.project_id = p.id
       WHERE r.project_id = ?
       ORDER BY r.financial_year DESC`,
      [projectId]
    )
  }

  public create(rate: MaintenanceRate): number {
    const result = dbService.run(
      `INSERT INTO maintenance_rates (
        project_id, financial_year, unit_type, rate_per_sqft, gst_percent, penalty_percentage, billing_frequency
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        rate.project_id,
        rate.financial_year,
        rate.unit_type || 'Bungalow',
        rate.rate_per_sqft,
        rate.gst_percent ?? 0,
        rate.penalty_percentage ?? null,
        rate.billing_frequency || 'YEARLY'
      ]
    )
    return result.lastInsertRowid as number
  }

  public update(id: number, rate: Partial<MaintenanceRate>): boolean {
    const allowedColumns = [
      'project_id',
      'financial_year',
      'unit_type',
      'rate_per_sqft',
      'gst_percent',
      'penalty_percentage',
      'billing_frequency'
    ]
    const keys = Object.keys(rate).filter(
      (key) =>
        allowedColumns.includes(key) &&
        key !== 'id' &&
        key !== 'project_name' &&
        key !== 'created_at'
    )

    if (keys.length === 0) return false

    const fields = keys.map((key) => `${key} = ?`).join(', ')
    const values = keys.map((key) => rate[key as keyof MaintenanceRate])

    const result = dbService.run(`UPDATE maintenance_rates SET ${fields} WHERE id = ?`, [
      ...values,
      id
    ])
    return result.changes > 0
  }

  public delete(id: number): boolean {
    return dbService.run('DELETE FROM maintenance_rates WHERE id = ?', [id]).changes > 0
  }

  // Slabs
  public getSlabs(rateId: number): MaintenanceSlab[] {
    const slabs = dbService.query<{
      id: number
      rate_id: number
      due_date: string
      discount_percentage: number
      is_early_payment: number
    }>('SELECT * FROM maintenance_slabs WHERE rate_id = ? ORDER BY due_date ASC', [rateId])
    return slabs.map((slab) => ({
      ...slab,
      is_early_payment: !!slab.is_early_payment
    }))
  }

  public addSlab(slab: MaintenanceSlab): number {
    const result = dbService.run(
      `INSERT INTO maintenance_slabs (rate_id, due_date, discount_percentage, is_early_payment)
       VALUES (?, ?, ?, ?)`,
      [slab.rate_id, slab.due_date, slab.discount_percentage, slab.is_early_payment ? 1 : 0]
    )
    return result.lastInsertRowid as number
  }

  public deleteSlab(id: number): boolean {
    return dbService.run('DELETE FROM maintenance_slabs WHERE id = ?', [id]).changes > 0
  }
}

export const maintenanceRateService = new MaintenanceRateService()
