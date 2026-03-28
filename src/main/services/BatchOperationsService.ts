/**
 * Batch operations service
 * Reduces N IPC calls to single call with array of items
 */

import { dbService } from '../db/database'
import { Payment } from './PaymentService'

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

    // Use a single transaction for all payments - no nested transactions
    const insertStmt = dbService.getDb().prepare(
      `INSERT INTO payments (
        project_id, unit_id, letter_id, financial_year, payment_date, payment_amount,
        payment_mode, cheque_number, remarks, payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const receiptStmt = dbService.getDb().prepare(
      `INSERT INTO receipts (payment_id, receipt_number, receipt_date) VALUES (?, ?, ?)`
    )

    const deletePaymentStmt = dbService.getDb().prepare('DELETE FROM payments WHERE id = ?')

    const getLetterStmt = dbService.getDb().prepare(
      `SELECT id, final_amount, unit_id, financial_year FROM maintenance_letters WHERE id = ?`
    )

    return dbService.transaction(() => {
      for (let i = 0; i < payments.length; i++) {
        const payment = payments[i]

        // Resolve letter_id and financial_year
        let resolvedLetterId = payment.letter_id
        let resolvedFinancialYear = payment.financial_year

        if (!resolvedFinancialYear && resolvedLetterId) {
          const letter = getLetterStmt.get(resolvedLetterId) as { financial_year: string } | undefined
          resolvedFinancialYear = letter?.financial_year
        }

        if (!resolvedFinancialYear) {
          const currentYear =
            new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear()
          resolvedFinancialYear = `${currentYear}-${(currentYear + 1).toString().slice(2)}`
        }

        if (!resolvedLetterId && resolvedFinancialYear) {
          const letter = dbService.get<{ id: number }>(
            `SELECT id FROM maintenance_letters WHERE unit_id = ? AND TRIM(financial_year) = TRIM(?)`,
            [payment.unit_id, resolvedFinancialYear]
          )
          resolvedLetterId = letter?.id
        }

        // Insert payment
        const result = insertStmt.run(
          payment.project_id,
          payment.unit_id,
          resolvedLetterId,
          resolvedFinancialYear,
          payment.payment_date,
          payment.payment_amount,
          payment.payment_mode,
          payment.cheque_number || null,
          payment.remarks || null,
          payment.payment_status || 'Received'
        )

        const paymentId = result.lastInsertRowid as number

        // Create receipt if not pending - failures roll back the payment
        if (payment.payment_status !== 'Pending') {
          const receiptNumber = payment.receipt_number || `REC-${paymentId}`
          try {
            receiptStmt.run(paymentId, receiptNumber, payment.payment_date)
          } catch (receiptError) {
            const message = receiptError instanceof Error ? receiptError.message : String(receiptError)
            // Roll back the payment to prevent orphaned records
            deletePaymentStmt.run(paymentId)
            results.push({ index: i, error: `Payment and receipt failed: ${message}` })
            failed++
            continue
          }
        }

        results.push({ index: i, paymentId })
        successful++
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

    // Use prepared statements to avoid nested transactions
    const getPaymentStmt = dbService.getDb().prepare('SELECT * FROM payments WHERE id = ?')
    const deletePaymentStmt = dbService.getDb().prepare('DELETE FROM payments WHERE id = ?')

    return dbService.transaction(() => {
      for (let i = 0; i < paymentIds.length; i++) {
        const paymentId = paymentIds[i]
        const payment = getPaymentStmt.get(paymentId) as { id: number; letter_id?: number; unit_id: number; financial_year?: string } | undefined

        if (!payment) {
          results.push({ index: i, error: 'Payment not found' })
          failed++
          continue
        }

        // Delete the payment
        const result = deletePaymentStmt.run(paymentId)

        if (result.changes > 0) {
          results.push({ index: i, paymentId })
          successful++
        } else {
          results.push({ index: i, error: 'No rows deleted' })
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
