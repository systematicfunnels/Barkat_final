import { test, expect } from '@playwright/test';
import { TestHelpers, testData } from './setup/test-helpers';

test.describe('Complete User Workflows E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await TestHelpers.mockElectronAPI(page);
    await TestHelpers.waitForAppLoad(page);
  });

  test('should complete full project setup workflow', async ({ page }) => {
    // Step 1: Create new project
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="add-project-btn"]').click();
    await TestHelpers.fillForm(page, testData.project);
    await TestHelpers.selectOption(page, 'status', 'Active');
    await page.locator('[data-testid="submit-btn"]').click();
    await TestHelpers.verifyToast(page, 'Project created successfully', 'success');

    // Step 2: Add units to project
    await page.locator('[data-testid="nav-units"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="add-unit-btn"]').click();
    await TestHelpers.selectOption(page, 'project_id', testData.project.name);
    await TestHelpers.fillForm(page, testData.unit);
    await TestHelpers.selectOption(page, 'unit_type', 'Flat');
    await TestHelpers.selectOption(page, 'status', 'Active');
    await page.locator('[data-testid="submit-btn"]').click();
    await TestHelpers.verifyToast(page, 'Unit created successfully', 'success');

    // Step 3: Generate maintenance letters
    await page.locator('[data-testid="nav-billing"]').click();
    await TestHelpers.waitForLoading(page);
    await TestHelpers.selectOption(page, 'project_id', testData.project.name);
    await page.locator('[data-testid="unit-1"]').check();
    await TestHelpers.selectOption(page, 'financial_year', '2024-25');
    await page.locator('[data-testid="generate-letters-btn"]').click();
    await TestHelpers.verifyToast(page, '1 maintenance letter generated successfully', 'success');

    // Step 4: Record payment
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="add-payment-btn"]').click();
    await TestHelpers.selectOption(page, 'project_id', testData.project.name);
    await TestHelpers.selectOption(page, 'unit_id', 'A-001 - John Doe');
    await TestHelpers.fillForm(page, testData.payment);
    await TestHelpers.selectOption(page, 'payment_mode', 'Transfer');
    await page.locator('[data-testid="submit-btn"]').click();
    await TestHelpers.verifyToast(page, 'Payment recorded successfully', 'success');

    // Step 5: Generate receipt
    await page.locator('[data-testid="checkbox-1"]').check();
    await page.locator('[data-testid="generate-receipts-btn"]').click();
    await page.waitForTimeout(2000);
    await TestHelpers.verifyToast(page, 'Receipts generated successfully', 'success');

    // Step 6: Verify in reports
    await page.locator('[data-testid="nav-reports"]').click();
    await TestHelpers.waitForLoading(page);
    await expect(page.locator('[data-testid="financial-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="table-row-1"]')).toContainText('A-001');
  });

  test('should handle bulk import workflow', async ({ page }) => {
    // Step 1: Import project from workbook
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="import-workbook-btn"]').click();
    await TestHelpers.uploadFile(page, 'workbook-file', 'test-workbook.xlsx');
    await page.locator('[data-testid="preview-import"]').click();
    await expect(page.locator('[data-testid="import-preview"]')).toBeVisible();
    await page.locator('[data-testid="confirm-import"]').click();
    await TestHelpers.verifyToast(page, 'Workbook imported successfully', 'success');

    // Step 2: Verify imported projects
    await TestHelpers.waitForLoading(page);
    await expect(page.locator('[data-testid="table-row-1"]')).toContainText('Test Society');

    // Step 3: Import additional units
    await page.locator('[data-testid="nav-units"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="import-excel-btn"]').click();
    await TestHelpers.selectOption(page, 'import-project', 'Test Society');
    await TestHelpers.uploadFile(page, 'excel-file', 'additional-units.xlsx');
    await page.locator('[data-testid="preview-import"]').click();
    await page.locator('[data-testid="confirm-import"]').click();
    await TestHelpers.verifyToast(page, 'Units imported successfully', 'success');

    // Step 4: Generate bulk letters
    await page.locator('[data-testid="nav-billing"]').click();
    await TestHelpers.waitForLoading(page);
    await TestHelpers.selectOption(page, 'project_id', 'Test Society');
    await page.locator('[data-testid="select-all-units"]').check();
    await TestHelpers.selectOption(page, 'financial_year', '2024-25');
    await page.locator('[data-testid="generate-letters-btn"]').click();
    await TestHelpers.verifyToast(page, 'maintenance letters generated successfully', 'success');

    // Step 5: Record bulk payments
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="bulk-payment-btn"]').click();
    await TestHelpers.selectOption(page, 'bulk-project', 'Test Society');
    await page.locator('[data-testid="add-entry-btn"]').click();
    await TestHelpers.selectOption(page, 'bulk-unit-1', 'A-001');
    await TestHelpers.fillForm(page, { payment_amount: '5000', payment_mode: 'Transfer' });
    await page.locator('[data-testid="submit-bulk-btn"]').click();
    await TestHelpers.verifyToast(page, 'payments recorded successfully', 'success');
  });

  test('should handle error recovery workflow', async ({ page }) => {
    // Step 1: Attempt project creation with validation errors
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="add-project-btn"]').click();
    await page.locator('[data-testid="submit-btn"]').click();
    await expect(page.locator('[data-testid="error-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-city"]')).toBeVisible();

    // Step 2: Fix validation errors
    await TestHelpers.fillForm(page, { name: 'Test Project', city: 'Test City' });
    await page.locator('[data-testid="submit-btn"]').click();
    await TestHelpers.verifyToast(page, 'Project created successfully', 'success');

    // Step 3: Handle API error during unit creation
    await TestHelpers.mockApiError(page, 'units', 'Database connection failed', 500);
    await page.locator('[data-testid="nav-units"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="add-unit-btn"]').click();
    await TestHelpers.selectOption(page, 'project_id', 'Test Project');
    await TestHelpers.fillForm(page, testData.unit);
    await page.locator('[data-testid="submit-btn"]').click();
    await TestHelpers.verifyToast(page, 'Failed to create unit', 'error');

    // Step 4: Retry unit creation after API recovery
    await TestHelpers.mockApiResponse(page, 'units', { id: 1 });
    await page.locator('[data-testid="submit-btn"]').click();
    await TestHelpers.verifyToast(page, 'Unit created successfully', 'success');
  });

  test('should handle data export and backup workflow', async ({ page }) => {
    // Step 1: Generate comprehensive report
    await page.locator('[data-testid="nav-reports"]').click();
    await TestHelpers.waitForLoading(page);
    await TestHelpers.selectOption(page, 'project-filter', 'All Projects');
    await TestHelpers.selectOption(page, 'year-filter', '2024-25');
    await page.locator('[data-testid="refresh-report"]').click();
    await TestHelpers.waitForLoading(page);

    // Step 2: Export financial data
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="export-excel-btn"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('financial-report');

    // Step 3: Export payment receipts
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="select-all-payments"]').check();
    await page.locator('[data-testid="export-receipts-btn"]').click();
    await TestHelpers.verifyToast(page, 'Receipts exported successfully', 'success');

    // Step 4: Generate backup
    await page.locator('[data-testid="nav-settings"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="backup-btn"]').click();
    await expect(page.locator('[data-testid="backup-progress"]')).toBeVisible();
    await page.waitForTimeout(3000);
    await TestHelpers.verifyToast(page, 'Backup completed successfully', 'success');
  });

  test('should handle user permissions and access control', async ({ page }) => {
    // Mock user with limited permissions
    await page.addInitScript(() => {
      (window as any).user = {
        role: 'operator',
        permissions: ['read', 'payment:create', 'unit:read'],
        restricted: ['project:delete', 'billing:generate']
      };
    });

    // Step 1: Test restricted access
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);
    
    // Delete button should be disabled for operator role
    await page.locator('[data-testid="checkbox-1"]').check();
    await expect(page.locator('[data-testid="delete-btn"]')).toBeDisabled();

    // Step 2: Test allowed operations
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="add-payment-btn"]').click();
    await expect(page.locator('[data-testid="payment-form"]')).toBeVisible();

    // Step 3: Test restricted billing access
    await page.locator('[data-testid="nav-billing"]').click();
    await TestHelpers.waitForLoading(page);
    await expect(page.locator('[data-testid="generate-letters-btn"]')).toBeDisabled();
    await expect(page.locator('[data-testid="access-denied"]')).toContainText('You don\'t have permission to generate letters');
  });

  test('should handle concurrent operations workflow', async ({ page }) => {
    // Step 1: Start background operation
    await page.locator('[data-testid="nav-billing"]').click();
    await TestHelpers.waitForLoading(page);
    await TestHelpers.selectOption(page, 'project_id', testData.project.name);
    await page.locator('[data-testid="select-all-units"]').check();
    await page.locator('[data-testid="generate-letters-btn"]').click();

    // Step 2: Navigate to another page while operation is running
    await page.locator('[data-testid="nav-payments"]').click();
    await TestHelpers.waitForLoading(page);

    // Step 3: Check operation progress
    await expect(page.locator('[data-testid="operation-status"]')).toBeVisible();
    await expect(page.locator('[data-testid="operation-status"]')).toContainText('Generating letters...');

    // Step 4: Start another operation
    await page.locator('[data-testid="add-payment-btn"]').click();
    await TestHelpers.selectOption(page, 'project_id', testData.project.name);
    await TestHelpers.fillForm(page, testData.payment);
    await page.locator('[data-testid="submit-btn"]').click();

    // Step 5: Verify both operations complete
    await page.waitForTimeout(3000);
    await TestHelpers.verifyToast(page, 'Letters generated successfully', 'success');
    await TestHelpers.verifyToast(page, 'Payment recorded successfully', 'success');
  });

  test('should handle search and filter workflow across pages', async ({ page }) => {
    // Step 1: Search in projects page
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);
    await page.locator('[data-testid="search-input"]').fill('Beverly Hills');
    await TestHelpers.waitForLoading(page);
    await TestHelpers.verifyTextContent(page, '[data-testid="table-row-1"]', 'Beverly Hills');

    // Step 2: Apply filters
    await TestHelpers.selectOption(page, 'status-filter', 'Active');
    await TestHelpers.selectOption(page, 'city-filter', 'Thane');
    await TestHelpers.waitForLoading(page);
    await TestHelpers.verifyTextContent(page, '[data-testid="filtered-results"]', '2 results');

    // Step 3: Clear filters and search
    await page.locator('[data-testid="clear-filters"]').click();
    await page.locator('[data-testid="search-input"]').clear();
    await TestHelpers.waitForLoading(page);
    const tableRows = page.locator('[data-testid="table-row-1"]');
    await expect(tableRows).toHaveCount(3);

    // Step 4: Test advanced search
    await page.locator('[data-testid="advanced-search"]').click();
    await TestHelpers.fillForm(page, {
      'search-name': 'Society',
      'search-city': 'Thane',
      'search-status': 'Active'
    });
    await page.locator('[data-testid="advanced-search-btn"]').click();
    await TestHelpers.waitForLoading(page);
    await expect(page.locator('[data-testid="search-results"]')).toContainText('3 societies found');
  });
});
