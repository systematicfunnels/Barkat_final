import { test, expect, Page } from '@playwright/test';

export class TestHelpers {
  static async waitForAppLoad(page: Page) {
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();
  }

  static async mockElectronAPI(page: Page) {
    await page.addInitScript(() => {
      // Mock window.api for Electron preload
      (window as any).api = {
        projects: {
          getAll: () => Promise.resolve([]),
          create: () => Promise.resolve({ id: 1 }),
          update: () => Promise.resolve({}),
          delete: () => Promise.resolve({}),
          getSectorPaymentConfigs: () => Promise.resolve([]),
          importWorkbook: () => Promise.resolve({
            projects: 1,
            units: 10,
            letters: 15
          })
        },
        units: {
          getAll: () => Promise.resolve([]),
          create: () => Promise.resolve({ id: 1 }),
          update: () => Promise.resolve({}),
          delete: () => Promise.resolve({}),
          importLedger: () => Promise.resolve({}),
          exportLedger: () => Promise.resolve({})
        },
        payments: {
          getAll: () => Promise.resolve([]),
          create: () => Promise.resolve({ id: 1 }),
          update: () => Promise.resolve({}),
          delete: () => Promise.resolve({}),
          generateReceipts: () => Promise.resolve({}),
          recordBulkPayments: () => Promise.resolve({})
        },
        billing: {
          getAll: () => Promise.resolve([]),
          generateLetters: () => Promise.resolve({
            generated: 5,
            failed: 0
          }),
          generatePDF: () => Promise.resolve({}),
          deleteLetters: () => Promise.resolve({})
        },
        reports: {
          getFinancialData: () => Promise.resolve([]),
          exportExcel: () => Promise.resolve({})
        },
        shell: {
          showItemInFolder: () => Promise.resolve({})
        }
      };
    });
  }

  static async fillForm(page: Page, formData: Record<string, string | number>) {
    for (const [field, value] of Object.entries(formData)) {
      await page.locator(`[data-testid="${field}"]`).fill(String(value));
    }
  }

  static async selectOption(page: Page, field: string, value: string) {
    await page.locator(`[data-testid="${field}"]`).click();
    await page.locator(`[data-testid="${field}-option"]:text-is("${value}")`).click();
  }

  static async uploadFile(page: Page, field: string, fileName: string) {
    const fileInput = page.locator(`input[type="file"][data-testid="${field}"]`);
    await fileInput.setInputFiles(fileName);
  }

  static async verifyToast(page: Page, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') {
    const toast = page.locator(`.ant-notification-${type}:has-text("${message}")`);
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(message);
  }

  static async verifyTableData(page: Page, expectedData: Record<string, string[]>) {
    for (const [column, values] of Object.entries(expectedData)) {
      const columnCells = page.locator(`[data-testid="table-column-${column}"]`);
      await expect(columnCells).toHaveCount(values.length);
      
      for (const value of values) {
        const cell = page.locator(`[data-testid="table-cell"]:text-is("${value}")`);
        await expect(cell).toBeVisible();
      }
    }
  }

  static async verifyTextContent(page: Page, selector: string, text: string) {
    const element = page.locator(selector);
    await expect(element).toContainText(text);
  }

  static async verifyElementContainsText(page: Page, element: any, text: string) {
    await expect(element).toContainText(text);
  }

  static async waitForLoading(page: Page, timeout = 10000) {
    await page.waitForSelector('.ant-spin-dot-item', { state: 'hidden', timeout });
  }

  static async mockApiResponse(page: Page, endpoint: string, response: any) {
    await page.route(`**/${endpoint}**`, (route: any) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response)
      });
    });
  }

  static async mockApiError(page: Page, endpoint: string, error: string, status = 500) {
    await page.route(`**/${endpoint}**`, (route: any) => {
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ error })
      });
    });
  }
}

export const testData = {
  project: {
    name: 'Test Beverly Hills Society',
    address: 'Sector A, Kharade, Shahpur',
    city: 'Thane',
    state: 'Maharashtra',
    pincode: '400602',
    status: 'Active',
    account_name: 'Test Society Account',
    bank_name: 'Test Bank',
    account_no: '1234567890',
    ifsc_code: 'TEST000123',
    branch: 'Test Branch'
  },
  unit: {
    unit_number: 'A-001',
    sector_code: 'A',
    owner_name: 'John Doe',
    area_sqft: 1200,
    unit_type: 'Flat',
    contact_number: '9876543210',
    email: 'john.doe@test.com',
    status: 'Active',
    penalty: 500
  },
  payment: {
    project_id: 1,
    unit_id: 1,
    payment_date: '2024-03-18',
    payment_amount: 5000,
    payment_mode: 'Transfer',
    remarks: 'Test payment'
  }
};
