import { test, expect } from '@playwright/test';
import { TestHelpers } from './setup/test-helpers';

test.describe('Reports & Analytics E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await TestHelpers.mockElectronAPI(page);
    await TestHelpers.waitForAppLoad(page);
  });

  test('should generate financial report', async ({ page }) => {
    // Mock financial data
    await TestHelpers.mockApiResponse(page, 'reports/financial', [
      {
        project_name: 'Test Project',
        unit_number: 'A-001',
        owner_name: 'John Doe',
        total_billed: 12000,
        total_paid: 10000,
        outstanding: 2000,
        yearly_data: {
          '2023-24': { billed: 6000, paid: 5000, balance: 1000 },
          '2024-25': { billed: 6000, paid: 5000, balance: 1000 }
        }
      },
      {
        project_name: 'Test Project',
        unit_number: 'A-002',
        owner_name: 'Jane Smith',
        total_billed: 15000,
        total_paid: 15000,
        outstanding: 0,
        yearly_data: {
          '2023-24': { billed: 7500, paid: 7500, balance: 0 },
          '2024-25': { billed: 7500, paid: 7500, balance: 0 }
        }
      }
    ]);

    // Navigate to Reports page
    await page.locator('[data-testid="nav-reports"]').click();
    await TestHelpers.waitForLoading(page);

    // Verify report data loads
    await expect(page.locator('[data-testid="financial-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="table-row-1"]')).toContainText('A-001');
    await expect(page.locator('[data-testid="table-row-2"]')).toContainText('A-002');

    // Verify summary statistics
    await expect(page.locator('[data-testid="total-billed"]')).toContainText('27,000');
    await expect(page.locator('[data-testid="total-paid"]')).toContainText('25,000');
    await expect(page.locator("[data-testid='total-outstanding']")).toContainText('2,000');

    // Test year filter
    await TestHelpers.selectOption(page, 'year-filter', '2024-25');
    await TestHelpers.waitForLoading(page);

    // Verify filtered data
    await expect(page.locator('[data-testid="year-2024-25-total"]')).toContainText('13,500');
  });

  test('should export financial report to Excel', async ({ page }) => {
    // Mock financial data
    await TestHelpers.mockApiResponse(page, 'reports/financial', [
      {
        project_name: 'Test Project',
        unit_number: 'A-001',
        owner_name: 'John Doe',
        total_billed: 12000,
        total_paid: 10000,
        outstanding: 2000
      }
    ]);

    // Navigate to Reports page
    await page.locator('[data-testid="nav-reports"]').click();
    await TestHelpers.waitForLoading(page);

    // Click Export Excel button
    await page.locator('[data-testid="export-excel-btn"]').click();

    // Verify export success
    await TestHelpers.verifyToast(page, 'Financial report exported successfully', 'success');

    // Verify download initiated
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="export-excel-btn"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('financial-report');
  });

  test('should filter reports by project and status', async ({ page }) => {
    // Mock projects and report data
    await TestHelpers.mockApiResponse(page, 'projects', [
      { id: 1, name: 'Beverly Hills Society' },
      { id: 2, name: 'Ocean View Apartments' }
    ]);
    await TestHelpers.mockApiResponse(page, 'reports/financial', [
      {
        project_name: 'Beverly Hills Society',
        unit_number: 'A-001',
        owner_name: 'John Doe',
        total_billed: 12000,
        total_paid: 10000,
        outstanding: 2000,
        status: 'pending'
      },
      {
        project_name: 'Ocean View Apartments',
        unit_number: 'B-001',
        owner_name: 'Jane Smith',
        total_billed: 15000,
        total_paid: 15000,
        outstanding: 0,
        status: 'paid'
      }
    ]);

    // Navigate to Reports page
    await page.locator('[data-testid="nav-reports"]').click();
    await TestHelpers.waitForLoading(page);

    // Test project filter
    await TestHelpers.selectOption(page, 'project-filter', 'Beverly Hills Society');
    await TestHelpers.waitForLoading(page);

    // Should only show Beverly Hills data
    await expect(page.locator('[data-testid="financial-table"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="table-row-1"]')).toContainText('Beverly Hills Society');

    // Clear project filter
    await page.locator('[data-testid="project-filter"]').selectOption({ index: 0 });
    await TestHelpers.waitForLoading(page);

    // Test status filter
    await TestHelpers.selectOption(page, 'status-filter', 'Paid');
    await TestHelpers.waitForLoading(page);

    // Should only show paid data
    await expect(page.locator('[data-testid="financial-table"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="table-row-1"]')).toContainText('Ocean View Apartments');
  });

  test('should display dashboard analytics', async ({ page }) => {
    // Mock dashboard data
    await TestHelpers.mockApiResponse(page, 'dashboard', {
      projects: 5,
      units: 120,
      total_billed: 1200000,
      total_paid: 1000000,
      total_outstanding: 200000,
      recent_payments: [
        { id: 1, unit_number: 'A-001', amount: 5000, date: '2024-03-18' },
        { id: 2, unit_number: 'B-002', amount: 6000, date: '2024-03-17' }
      ],
      billing_summary: {
        pending: 25,
        paid: 95,
        overdue: 8
      }
    });

    // Navigate to Dashboard page
    await page.locator('[data-testid="nav-dashboard"]').click();
    await TestHelpers.waitForLoading(page);

    // Verify dashboard statistics
    await expect(page.locator('[data-testid="total-projects"]')).toContainText('5');
    await expect(page.locator('[data-testid="total-units"]')).toContainText('120');
    await expect(page.locator('[data-testid="total-revenue"]')).toContainText('12,00,000');
    await expect(page.locator('[data-testid="total-outstanding"]')).toContainText('2,00,000');

    // Verify recent payments
    await expect(page.locator('[data-testid="recent-payments"]')).toBeVisible();
    await expect(page.locator('[data-testid="payment-row-1"]')).toContainText('A-001');
    await expect(page.locator('[data-testid="payment-row-1"]')).toContainText('5,000');

    // Verify billing summary
    await expect(page.locator('[data-testid="billing-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="pending-count"]')).toContainText('25');
    await expect(page.locator('[data-testid="paid-count"]')).toContainText('95');
    await expect(page.locator('[data-testid="overdue-count"]')).toContainText('8');
  });

  test('should filter dashboard by financial year', async ({ page }) => {
    // Mock dashboard data for different years
    await TestHelpers.mockApiResponse(page, 'dashboard', {
      projects: 5,
      units: 120,
      available_years: ['2023-24', '2024-25', '2025-26'],
      current_year_stats: {
        total_billed: 1200000,
        total_paid: 1000000,
        total_outstanding: 200000
      },
      year_wise_data: {
        '2023-24': { total_billed: 1000000, total_paid: 800000, total_outstanding: 200000 },
        '2024-25': { total_billed: 1200000, total_paid: 1000000, total_outstanding: 200000 }
      }
    });

    // Navigate to Dashboard page
    await page.locator('[data-testid="nav-dashboard"]').click();
    await TestHelpers.waitForLoading(page);

    // Test year selector
    await TestHelpers.selectOption(page, 'financial-year', '2023-24');
    await TestHelpers.waitForLoading(page);

    // Verify year-specific data
    await expect(page.locator('[data-testid="total-revenue"]')).toContainText('10,00,000');
    await expect(page.locator('[data-testid="total-outstanding"]')).toContainText('2,00,000');

    // Test year selector for 2025-26
    await TestHelpers.selectOption(page, 'financial-year', '2025-26');
    await TestHelpers.waitForLoading(page);

    // Verify no data message for future year
    await expect(page.locator('[data-testid="no-data-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="no-data-message"]')).toContainText('No data available for 2025-26');
  });

  test('should handle report generation errors', async ({ page }) => {
    // Mock API error
    await TestHelpers.mockApiError(page, 'reports/financial', 'Database query failed', 500);

    // Navigate to Reports page
    await page.locator('[data-testid="nav-reports"]').click();
    await TestHelpers.waitForLoading(page);

    // Verify error message
    await TestHelpers.verifyToast(page, 'Failed to load financial data', 'error');

    // Export button should be disabled
    await expect(page.locator('[data-testid="export-excel-btn"]')).toBeDisabled();
  });

  test('should validate report date range', async ({ page }) => {
    // Navigate to Reports page
    await page.locator('[data-testid="nav-reports"]').click();
    await TestHelpers.waitForLoading(page);

    // Test invalid date range (end date before start date)
    await page.locator('[data-testid="date-from"]').fill('2024-03-20');
    await page.locator('[data-testid="date-to"]').fill('2024-03-15');

    // Click Apply filter
    await page.locator('[data-testid="apply-filter"]').click();

    // Verify validation error
    await expect(page.locator('[data-testid="date-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="date-error"]')).toContainText('End date must be after start date');

    // Test date range exceeding limits
    await page.locator('[data-testid="date-from"]').fill('2020-01-01');
    await page.locator('[data-testid="date-to"]').fill('2025-12-31');
    await page.locator('[data-testid="apply-filter"]').click();

    // Verify validation error
    await expect(page.locator('[data-testid="date-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="date-error"]')).toContainText('Date range cannot exceed 2 years');
  });
});
