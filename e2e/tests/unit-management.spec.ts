import { test, expect } from '@playwright/test';
import { TestHelpers, testData } from './setup/test-helpers';

test.describe('Unit Management E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await TestHelpers.mockElectronAPI(page);
    await TestHelpers.waitForAppLoad(page);
  });

  test('should create new unit successfully', async ({ page }) => {
    // Mock projects for dropdown
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: testData.project.name }
    ]);

    // Navigate to Units page
    await page.locator('[data-testid="nav-units"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Add Unit button
    await page.locator('[data-testid="add-unit-btn"]').click();

    // Select project
    await TestHelpers.selectOption(page, 'project_id', testData.project.name);

    // Fill unit form
    await TestHelpers.fillForm(page, testData.unit);
    await TestHelpers.selectOption(page, 'unit_type', 'Flat');
    await TestHelpers.selectOption(page, 'status', 'Active');

    // Submit form
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify success message
    await TestHelpers.verifyToast(page, 'Unit created successfully', 'success');

    // Verify unit appears in table
    await TestHelpers.verifyTableData(page, {
      'unit_number': [testData.unit.unit_number],
      'owner_name': [testData.unit.owner_name],
      'status': [testData.unit.status]
    });
  });

  test('should import units from Excel file', async ({ page }) => {
    // Mock projects for dropdown
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: testData.project.name }
    ]);

    // Navigate to Units page
    await page.locator('[data-testid="nav-units"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Import Excel button
    await page.locator('[data-testid="import-excel-btn"]').click();

    // Select project
    await TestHelpers.selectOption(page, 'import-project', testData.project.name);

    // Upload Excel file
    await TestHelpers.uploadFile(page, 'excel-file', 'test-units.xlsx');

    // Preview import
    await page.locator('[data-testid="preview-import"]').click();

    // Verify preview data
    await expect(page.locator('[data-testid="import-preview"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-units"]')).toContainText('Units found: 5');

    // Confirm import
    await page.locator('[data-testid="confirm-import"]').click();

    // Verify import success
    await TestHelpers.verifyToast(page, 'Units imported successfully', 'success');
  });

  test('should edit existing unit', async ({ page }) => {
    // Mock existing units and projects
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: testData.project.name }
    ]);
    await TestHelpers.mockApiResponse(page, 'units', [
      { id: 1, project_id: 1, ...testData.unit }
    ]);

    // Navigate to Units page
    await page.locator('[data-testid="nav-units"]').click();
    await TestHelpers.waitForLoading(page);

    // Click edit button
    await page.locator('[data-testid="edit-unit-1"]').click();

    // Update unit details
    const updatedOwner = 'Jane Smith';
    await page.locator('[data-testid="owner_name"]').clear();
    await page.locator('[data-testid="owner_name"]').fill(updatedOwner);

    // Submit changes
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify success message
    await TestHelpers.verifyToast(page, 'Unit updated successfully', 'success');

    // Verify updated data in table
    await TestHelpers.verifyTableData(page, {
      'owner_name': [updatedOwner]
    });
  });

  test('should delete units in bulk', async ({ page }) => {
    // Mock existing units
    await TestHelpers.mockApiResponse(page, 'units', [
      { id: 1, unit_number: 'A-001', owner_name: 'John Doe' },
      { id: 2, unit_number: 'A-002', owner_name: 'Jane Smith' }
    ]);

    // Navigate to Units page
    await page.locator('[data-testid="nav-units"]').click();
    await TestHelpers.waitForLoading(page);

    // Select multiple units
    await page.locator('[data-testid="checkbox-1"]').check();
    await page.locator('[data-testid="checkbox-2"]').check();

    // Click delete button
    await page.locator('[data-testid="delete-btn"]').click();

    // Verify confirmation dialog
    await expect(page.locator('[data-testid="bulk-delete-confirmation"]')).toBeVisible();
    await expect(page.locator('[data-testid="bulk-delete-confirmation"]')).toContainText('Are you sure you want to delete 2 selected units?');

    // Confirm deletion
    await page.locator('[data-testid="confirm-bulk-delete"]').click();

    // Verify success message
    await TestHelpers.verifyToast(page, '2 units deleted successfully', 'success');

    // Verify units removed from table
    await expect(page.locator('[data-testid="table-row-1"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="table-row-2"]')).not.toBeVisible();
  });

  test('should validate unit form fields', async ({ page }) => {
    // Mock projects
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: testData.project.name }
    ]);

    // Navigate to Units page
    await page.locator('[data-testid="nav-units"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Add Unit button
    await page.locator('[data-testid="add-unit-btn"]').click();

    // Submit empty form
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify validation errors
    await expect(page.locator('[data-testid="error-unit_number"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-unit_number"]')).toContainText('Unit number is required');
    await expect(page.locator('[data-testid="error-owner_name"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-owner_name"]')).toContainText('Owner name is required');

    // Fill partial form and submit
    await TestHelpers.fillForm(page, { unit_number: 'A-001' });
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify remaining validation errors
    await expect(page.locator('[data-testid="error-owner_name"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-unit_number"]')).not.toBeVisible();
  });

  test('should handle unit import with invalid data', async ({ page }) => {
    // Mock projects
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: testData.project.name }
    ]);

    // Navigate to Units page
    await page.locator('[data-testid="nav-units"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Import Excel button
    await page.locator('[data-testid="import-excel-btn"]').click();

    // Select project
    await TestHelpers.selectOption(page, 'import-project', testData.project.name);

    // Upload invalid Excel file
    await TestHelpers.uploadFile(page, 'excel-file', 'invalid-units.xlsx');

    // Preview import
    await page.locator('[data-testid="preview-import"]').click();

    // Verify error message
    await expect(page.locator('[data-testid="import-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="import-error"]')).toContainText('No units recognized');

    // Cannot proceed with import
    await expect(page.locator('[data-testid="confirm-import"]')).toBeDisabled();
  });

  test('should filter and search units', async ({ page }) => {
    // Mock multiple units
    await TestHelpers.mockApiResponse(page, 'units', [
      { id: 1, unit_number: 'A-001', owner_name: 'John Doe', project_id: 1, status: 'Active', unit_type: 'Flat', area_sqft: 1200 },
      { id: 2, unit_number: 'B-002', owner_name: 'Jane Smith', project_id: 1, status: 'Inactive', unit_type: 'Bungalow', area_sqft: 1500 },
      { id: 3, unit_number: 'A-003', owner_name: 'Bob Johnson', project_id: 2, status: 'Active', unit_type: 'Flat', area_sqft: 1000 }
    ]);

    // Navigate to Units page
    await page.locator('[data-testid="nav-units"]').click();
    await TestHelpers.waitForLoading(page);

    // Test search functionality
    await page.locator('[data-testid="search-input"]').fill('A-001');
    await TestHelpers.waitForLoading(page);
    await TestHelpers.verifyTableData(page, {
      'unit_number': ['A-001']
    });

    // Clear search
    await page.locator('[data-testid="search-input"]').clear();
    await TestHelpers.waitForLoading(page);

    // Test status filter
    await TestHelpers.selectOption(page, 'status-filter', 'Active');
    await TestHelpers.waitForLoading(page);
    await TestHelpers.verifyTableData(page, {
      'status': ['Active', 'Active']
    });

    // Test unit type filter
    await TestHelpers.selectOption(page, 'unit_type-filter', 'Flat');
    await TestHelpers.waitForLoading(page);
    await TestHelpers.verifyTableData(page, {
      'unit_type': ['Flat', 'Flat']
    });

    // Test area range filter
    await page.locator('[data-testid="area-min"]').fill('1100');
    await page.locator('[data-testid="area-max"]').fill('1400');
    await TestHelpers.waitForLoading(page);
    await TestHelpers.verifyTableData(page, {
      'area_sqft': ['1200']
    });
  });
});
