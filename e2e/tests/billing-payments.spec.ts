import { test, expect } from '@playwright/test';
import { TestHelpers, testData } from './setup/test-helpers';

test.describe('Billing & Payments E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await TestHelpers.mockElectronAPI(page);
    await TestHelpers.waitForAppLoad(page);
  });

  test('should generate maintenance letters', async ({ page }) => {
    // Mock projects and units
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: testData.project.name }
    ]);
    await TestHelpers.mockApiResponse(page, 'units', [
      { id: 1, project_id: 1, unit_number: 'A-001', owner_name: 'John Doe', status: 'Active' },
      { id: 2, project_id: 1, unit_number: 'A-002', owner_name: 'Jane Smith', status: 'Active' }
    ]);

    // Navigate to Billing page
    await page.locator('[data-testid="nav-billing"]').click();
    await TestHelpers.waitForLoading(page);

    // Select project
    await TestHelpers.selectOption(page, 'project_id', testData.project.name);

    // Select units
    await page.locator('[data-testid="unit-1"]').check();
    await page.locator('[data-testid="unit-2"]').check();

    // Set financial year
    await TestHelpers.selectOption(page, 'financial_year', '2024-25');

    // Generate letters
    await page.locator('[data-testid="generate-letters-btn"]').click();

    // Verify generation success
    await TestHelpers.verifyToast(page, '2 maintenance letters generated successfully', 'success');

    // Verify letters appear in table
    await expect(page.locator('[data-testid="letters-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="table-row-1"]')).toContainText('A-001');
    await expect(page.locator('[data-testid="table-row-2"]')).toContainText('A-002');
  });

  test('should create payment record', async ({ page }) => {
    // Mock projects and units
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: testData.project.name }
    ]);
    await TestHelpers.mockApiResponse(page, 'units', [
      { id: 1, project_id: 1, unit_number: 'A-001', owner_name: 'John Doe' }
    ]);
    await TestHelpers.mockApiResponse(page, 'letters', [
      { id: 1, project_id: 1, unit_id: 1, final_amount: 5000, status: 'pending' }
    ]);

    // Navigate to Payments page
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Add Payment button
    await page.locator('[data-testid="add-payment-btn"]').click();

    // Fill payment form
    await TestHelpers.selectOption(page, 'project_id', testData.project.name);
    await TestHelpers.selectOption(page, 'unit_id', 'A-001 - John Doe');
    await TestHelpers.fillForm(page, testData.payment);
    await TestHelpers.selectOption(page, 'payment_mode', 'Transfer');

    // Submit payment
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify success message
    await TestHelpers.verifyToast(page, 'Payment recorded successfully', 'success');

    // Verify payment appears in table
    await TestHelpers.verifyTableData(page, {
      'unit_number': ['A-001'],
      'payment_amount': ['5000'],
      'payment_mode': ['Transfer']
    });
  });

  test('should record bulk payments', async ({ page }) => {
    // Mock data
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: testData.project.name }
    ]);
    await TestHelpers.mockApiResponse(page, 'units', [
      { id: 1, project_id: 1, unit_number: 'A-001', owner_name: 'John Doe', final_amount: 5000 },
      { id: 2, project_id: 1, unit_number: 'A-002', owner_name: 'Jane Smith', final_amount: 6000 }
    ]);
    await TestHelpers.mockApiResponse(page, 'letters', [
      { id: 1, project_id: 1, unit_id: 1, final_amount: 5000 },
      { id: 2, project_id: 1, unit_id: 2, final_amount: 6000 }
    ]);

    // Navigate to Payments page
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Bulk Payment button
    await page.locator('[data-testid="bulk-payment-btn"]').click();

    // Select project
    await TestHelpers.selectOption(page, 'bulk-project', testData.project.name);

    // Add payment entries
    await page.locator('[data-testid="add-entry-btn"]').click();
    await TestHelpers.selectOption(page, 'bulk-unit-1', 'A-001 - John Doe');
    await TestHelpers.fillForm(page, { payment_amount: '5000', payment_mode: 'Transfer' });

    await page.locator('[data-testid="add-entry-btn"]').click();
    await TestHelpers.selectOption(page, 'bulk-unit-2', 'A-002 - Jane Smith');
    await TestHelpers.fillForm(page, { payment_amount: '6000', payment_mode: 'Cheque' });

    // Submit bulk payments
    await page.locator('[data-testid="submit-bulk-btn"]').click();

    // Verify success message
    await TestHelpers.verifyToast(page, '2 payments recorded successfully', 'success');

    // Verify payments appear in table
    await expect(page.locator('[data-testid="payments-table"]')).toHaveCount(2);
  });

  test('should generate PDF receipts', async ({ page }) => {
    // Mock payments
    await TestHelpers.mockApiResponse(page, 'payments', [
      { id: 1, project_id: 1, unit_id: 1, payment_amount: 5000, payment_date: '2024-03-18' },
      { id: 2, project_id: 1, unit_id: 2, payment_amount: 6000, payment_date: '2024-03-18' }
    ]);

    // Navigate to Payments page
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);

    // Select payments
    await page.locator('[data-testid="checkbox-1"]').check();
    await page.locator('[data-testid="checkbox-2"]').check();

    // Generate receipts
    await page.locator('[data-testid="generate-receipts-btn"]').click();

    // Verify generation progress
    await expect(page.locator('[data-testid="receipt-progress"]')).toBeVisible();
    await TestHelpers.verifyTextContent(page, '[data-testid="receipt-progress"]', 'Generating receipts...');

    // Wait for completion
    await page.waitForTimeout(2000);

    // Verify success message
    await TestHelpers.verifyToast(page, 'Receipts generated successfully', 'success');
  });

  test('should validate payment form fields', async ({ page }) => {
    // Mock projects and units
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: testData.project.name }
    ]);
    await TestHelpers.mockApiResponse(page, 'units', [
      { id: 1, project_id: 1, unit_number: 'A-001', owner_name: 'John Doe' }
    ]);

    // Navigate to Payments page
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Add Payment button
    await page.locator('[data-testid="add-payment-btn"]').click();

    // Submit empty form
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify validation errors
    await expect(page.locator('[data-testid="error-payment_amount"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-payment_amount"]')).toContainText('Payment amount is required');
    await expect(page.locator('[data-testid="error-payment_date"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-payment_date"]')).toContainText('Payment date is required');

    // Fill partial form
    await TestHelpers.fillForm(page, { payment_amount: '5000' });
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify remaining validation errors
    await expect(page.locator('[data-testid="error-payment_date"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-payment_amount"]')).not.toBeVisible();
  });

  test('should handle payment creation with invalid amount', async ({ page }) => {
    // Mock projects and units
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: testData.project.name }
    ]);
    await TestHelpers.mockApiResponse(page, 'units', [
      { id: 1, project_id: 1, unit_number: 'A-001', owner_name: 'John Doe' }
    ]);

    // Navigate to Payments page
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Add Payment button
    await page.locator('[data-testid="add-payment-btn"]').click();

    // Fill form with invalid amount
    await TestHelpers.fillForm(page, { payment_amount: '-1000' });
    await TestHelpers.fillForm(page, { payment_date: '2024-03-18' });

    // Submit form
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify validation error
    await expect(page.locator('[data-testid="error-payment_amount"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-payment_amount"]')).toContainText('Payment amount must be positive');
  });

  test('should filter payments by date and status', async ({ page }) => {
    // Mock payments with different dates
    await TestHelpers.mockApiResponse(page, 'payments', [
      { id: 1, project_id: 1, unit_id: 1, payment_amount: 5000, payment_date: '2024-03-15', status: 'completed' },
      { id: 2, project_id: 1, unit_id: 2, payment_amount: 6000, payment_date: '2024-03-20', status: 'pending' }
    ]);

    // Navigate to Payments page
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);

    // Test date range filter
    await page.locator('[data-testid="date-from"]').fill('2024-03-10');
    await page.locator('[data-testid="date-to"]').fill('2024-03-18');
    await TestHelpers.waitForLoading(page);

    // Should only show payment from March 15
    await expect(page.locator('[data-testid="payments-table"]')).toHaveCount(1);
    await TestHelpers.verifyTextContent(page, '[data-testid="table-row-1"]', '2024-03-15');

    // Test status filter
    await page.locator('[data-testid="date-from"]').clear();
    await page.locator('[data-testid="date-to"]').clear();
    await TestHelpers.selectOption(page, 'status-filter', 'completed');
    await TestHelpers.waitForLoading(page);

    // Should only show completed payments
    await expect(page.locator('[data-testid="payments-table"]')).toHaveCount(1);
    await TestHelpers.verifyTextContent(page, '[data-testid="table-row-1"]', 'completed');
  });

  test('should handle bulk payment generation errors', async ({ page }) => {
    // Mock API error for bulk payment
    await TestHelpers.mockApiError(page, 'payments/bulk', 'Database transaction failed', 500);

    // Navigate to Payments page
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Bulk Payment button
    await page.locator('[data-testid="bulk-payment-btn"]').click();

    // Select project and add entry
    await TestHelpers.selectOption(page, 'bulk-project', testData.project.name);
    await page.locator('[data-testid="add-entry-btn"]').click();
    await TestHelpers.selectOption(page, 'bulk-unit-1', 'A-001 - John Doe');
    await TestHelpers.fillForm(page, { payment_amount: '5000', payment_mode: 'Transfer' });

    // Submit bulk payment
    await page.locator('[data-testid="submit-bulk-btn"]').click();

    // Verify error message
    await TestHelpers.verifyToast(page, 'Failed to record bulk payments', 'error');
  });
});
