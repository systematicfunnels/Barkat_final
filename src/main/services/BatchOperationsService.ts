/**
 * Batch operations service
 * Reduces N IPC calls to single call with array of items
 */

import { dbService } from '../db/database'
import { paymentService, Payment } from './PaymentService'

export interface BulkPaymentResult {
  successful: number
  failed: number
  results: Array<{
    index: number
    paymentId?: number
    error?: string
  }>
}

class BatchOperationsService {
  /**
   * Create multiple payments in one IPC call
   * Significantly reduces round-trip overhead for bulk operations
   */
  public createBulkPayments(payments: Payment[]): BulkPaymentResult {
    const results: BulkPaymentResult['results'] = []
    let successful = 0
    let failed = 0

    return dbService.transaction(() => {
      for (let i = 0; i < payments.length; i++) {
        try {
          const paymentId = paymentService.create(payments[i])
          results.push({ index: i, paymentId })
          successful++
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          results.push({ index: i, error: message })
          failed++
          // Continue processing other payments even if one fails
        }
      }

      return { successful, failed, results } as BulkPaymentResult
    })
  }

  /**
   * Delete multiple records in one operation
   */
  public bulkDeletePayments(paymentIds: number[]): BulkPaymentResult {
    const results: BulkPaymentResult['results'] = []
    let successful = 0
    let failed = 0

    return dbService.transaction(() => {
      for (let i = 0; i < paymentIds.length; i++) {
        try {
          paymentService.delete(paymentIds[i])
          results.push({ index: i, paymentId: paymentIds[i] })
          successful++
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          results.push({ index: i, error: message })
          failed++
        }
      }

      return { successful, failed, results } as BulkPaymentResult
    })
  }

  /**
   * Create units with single transaction
   */
  public bulkCreateUnits(
    projectId: number,
    units: Array<{
      unit_number: string
      owner_name: string
      area_sqft: number
      unit_type?: string
      sector_code?: string
      status?: string
      contact_number?: string
      email?: string
    }>
  ): { successful: number; failed: number; unitIds: number[] } {
    const unitIds: number[] = []

    dbService.transaction(() => {
      for (const unit of units) {
        try {
          const result = dbService.run(
            `INSERT INTO units (
              project_id, unit_number, owner_name, area_sqft, unit_type,
              sector_code, status, contact_number, email
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              projectId,
              unit.unit_number,
              unit.owner_name,
              unit.area_sqft,
              unit.unit_type || '',
              unit.sector_code || '',
              unit.status || 'Occupied',
              unit.contact_number || '',
              unit.email || ''
            ]
          )
          unitIds.push(result.lastInsertRowid as number)
        } catch (error) {
          console.error('Error creating unit:', error)
        }
      }
    })

    return {
      successful: unitIds.length,
      failed: units.length - unitIds.length,
      unitIds
    }
  }
}

export const batchOperationsService = new BatchOperationsService()
