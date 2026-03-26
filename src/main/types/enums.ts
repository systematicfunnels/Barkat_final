/**
 * Enums for all status types used in the application
 * These ensure type safety and prevent typos that create orphaned records
 */

export enum ProjectStatus {
  ACTIVE = 'Sold',
  INACTIVE = 'Unsold'
}

export enum UnitStatus {
  ACTIVE = 'Sold',
  INACTIVE = 'Unsold',
  VACANT = 'Vacant'
}

export enum PaymentStatus {
  RECEIVED = 'Received',
  PENDING = 'Pending'
}

export enum MaintenanceLetterStatus {
  GENERATED = 'Generated',
  MODIFIED = 'Modified',
  PENDING = 'Pending',
  PAID = 'Paid'
}

export enum PaymentMode {
  CASH = 'Cash',
  CHEQUE = 'Cheque',
  UPI = 'UPI'
}

export enum UnitType {
  BUNGALOW = 'Bungalow',
  PLOT = 'Plot',
  GARDEN = 'Garden',
  BMF = 'BMF',
  ALL = 'All'
}

export enum BillingFrequency {
  YEARLY = 'YEARLY',
  QUARTERLY = 'QUARTERLY',
  MONTHLY = 'MONTHLY'
}
