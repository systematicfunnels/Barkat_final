export const CONFIG = {
  // PDF Generation Constants
  PDF: {
    PAGE_SIZE: [595.28, 841.89] as [number, number], // A4 size
    MARGIN: 40,
    FONT_SIZES: {
      HEADER: 22,
      SUBHEADER: 10,
      BODY: 9,
      FOOTER: 8,
      SUBJECT: 11
    },
    COLORS: {
      NAVY: { r: 0.12, g: 0.24, b: 0.42 },
      TEXT: { r: 0.2, g: 0.2, b: 0.2 },
      GRAY: { r: 0.55, g: 0.55, b: 0.55 },
      LINE: { r: 0.88, g: 0.88, b: 0.88 },
      HEADER_BG: { r: 0.97, g: 0.97, b: 0.97 },
      GOLD: { r: 0.75, g: 0.55, b: 0.2 },
      RED: { r: 0.8, g: 0.1, b: 0.1 }
    }
  },

  // Business Logic Constants
  BUSINESS: {
    DISCOUNT_RATE: 0.1, // 10% early payment discount
    DEFAULT_RATE_PER_SQFT: 3.6,
    BUNGALOW_MULTIPLIER: 1.3,
    PENALTY_RATE: 0.21, // 21% annual penalty rate
    MIN_PAYMENT_AMOUNT: 1
  },

  // Database Constants
  DATABASE: {
    MAX_LOG_SIZE: 1000,
    BATCH_SIZE: 100,
    TRANSACTION_TIMEOUT: 30000 // 30 seconds
  },

  // File System Constants
  FILES: {
    PDF_DIRECTORY: 'maintenance_letters',
    BILL_DIRECTORY: 'maintenance_bills',
    BACKUP_DIRECTORY: 'backups',
    MAX_FILENAME_LENGTH: 255
  },

  // UI Constants
  UI: {
    TABLE_PAGE_SIZE: 50,
    DEBOUNCE_DELAY: 300,
    TOAST_DURATION: 3000
  },

  // Validation Constants
  VALIDATION: {
    MIN_PROJECT_NAME_LENGTH: 2,
    MAX_PROJECT_NAME_LENGTH: 100,
    MIN_UNIT_NUMBER_LENGTH: 1,
    MAX_UNIT_NUMBER_LENGTH: 20,
    MIN_OWNER_NAME_LENGTH: 2,
    MAX_OWNER_NAME_LENGTH: 100
  }
} as const

export type ConfigType = typeof CONFIG
