import { test, expect } from '@playwright/test';
import { TestHelpers, testData } from './setup/test-helpers';

test.describe('Project Management E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await TestHelpers.mockElectronAPI(page);
    await TestHelpers.waitForAppLoad(page);
  });

  test('should create new project successfully', async ({ page }) => {
    // Navigate to Projects page
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Add Project button
    await page.locator('[data-testid="add-project-btn"]').click();

    // Fill project form
    await TestHelpers.fillForm(page, testData.project);
    await TestHelpers.selectOption(page, 'status', 'Active');

    // Submit form
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify success message
    await TestHelpers.verifyToast(page, 'Project created successfully', 'success');

    // Verify project appears in table
    await TestHelpers.verifyTableData(page, {
      'name': [testData.project.name],
      'city': [testData.project.city],
      'status': [testData.project.status]
    });
  });

  test('should edit existing project', async ({ page }) => {
    // Mock existing projects
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, ...testData.project }
    ]);

    // Navigate to Projects page
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);

    // Click edit button
    await page.locator('[data-testid="edit-project-1"]').click();

    // Update project name
    const updatedName = 'Updated Beverly Hills Society';
    await page.locator('[data-testid="name"]').clear();
    await page.locator('[data-testid="name"]').fill(updatedName);

    // Submit changes
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify success message
    await TestHelpers.verifyToast(page, 'Project updated successfully', 'success');

    // Verify updated data in table
    await TestHelpers.verifyTableData(page, {
      'name': [updatedName]
    });
  });

  test('should delete project with confirmation', async ({ page }) => {
    // Mock existing projects
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, ...testData.project }
    ]);

    // Navigate to Projects page
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);

    // Select project
    await page.locator('[data-testid="checkbox-1"]').check();

    // Click delete button
    await page.locator('[data-testid="delete-btn"]').click();

    // Verify confirmation dialog
    await expect(page.locator('[data-testid="delete-confirmation"]')).toBeVisible();
    await expect(page.locator('[data-testid="delete-confirmation"]')).toContainText('Are you sure you want to delete');

    // Confirm deletion
    await page.locator('[data-testid="confirm-delete"]').click();

    // Verify success message
    await TestHelpers.verifyToast(page, 'Project deleted successfully', 'success');

    // Verify project removed from table
    await expect(page.locator('[data-testid="table-row-1"]')).not.toBeVisible();
  });

  test('should import project from Excel workbook', async ({ page }) => {
    // Navigate to Projects page
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Import Workbook button
    await page.locator('[data-testid="import-workbook-btn"]').click();

    // Upload Excel file
    await TestHelpers.uploadFile(page, 'workbook-file', 'test-workbook.xlsx');

    // Preview import
    await page.locator('[data-testid="preview-import"]').click();

    // Verify preview data
    await expect(page.locator('[data-testid="import-preview"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-projects"]')).toContainText('Projects found: 1');
    await expect(page.locator('[data-testid="preview-units"]')).toContainText('Units found: 10');
    await expect(page.locator('[data-testid="preview-letters"]')).toContainText('Letters found: 15');

    // Confirm import
    await page.locator('[data-testid="confirm-import"]').click();

    // Verify import success
    await TestHelpers.verifyToast(page, 'Workbook imported successfully', 'success');
    await TestHelpers.verifyToast(page, '1 projects, 10 units, 15 letters imported', 'success');
  });

  test('should validate project form fields', async ({ page }) => {
    // Navigate to Projects page
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Add Project button
    await page.locator('[data-testid="add-project-btn"]').click();

    // Submit empty form
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify validation errors
    await expect(page.locator('[data-testid="error-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-name"]')).toContainText('Project name is required');
    await expect(page.locator('[data-testid="error-city"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-city"]')).toContainText('City is required');

    // Fill partial form and submit
    await TestHelpers.fillForm(page, { name: 'Test Project' });
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify remaining validation errors
    await expect(page.locator('[data-testid="error-city"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-name"]')).not.toBeVisible();
  });

  test('should handle project creation API error', async ({ page }) => {
    // Mock API error
    await TestHelpers.mockApiError(page, 'projects', 'Database connection failed', 500);

    // Navigate to Projects page
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Add Project button
    await page.locator('[data-testid="add-project-btn"]').click();

    // Fill and submit form
    await TestHelpers.fillForm(page, testData.project);
    await page.locator('[data-testid="submit-btn"]').click();

    // Verify error message
    await TestHelpers.verifyToast(page, 'Failed to create project', 'error');
  });

  test('should filter and search projects', async ({ page }) => {
    // Mock multiple projects
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: 'Beverly Hills Society', city: 'Thane', status: 'Active' },
      { id: 2, name: 'Ocean View Apartments', city: 'Mumbai', status: 'Inactive' },
      { id: 3, name: 'Green Valley Complex', city: 'Thane', status: 'Active' }
    ]);

    // Navigate to Projects page
    await page.locator('[data-testid="nav-projects"]').click();
    await TestHelpers.waitForLoading(page);

    // Test search functionality
    await page.locator('[data-testid="search-input"]').fill('Beverly Hills');
    await TestHelpers.waitForLoading(page);
    await TestHelpers.verifyTableData(page, {
      'name': ['Beverly Hills Society']
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

    // Test city filter
    await TestHelpers.selectOption(page, 'city-filter', 'Thane');
    await TestHelpers.waitForLoading(page);
    await TestHelpers.verifyTableData(page, {
      'city': ['Thane', 'Thane']
    });
  });
});
