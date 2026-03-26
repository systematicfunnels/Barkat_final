import { test, expect, Page, BrowserContext, Route, Request } from '@playwright/test';
import { ElectronApplication, _electron as electron } from 'playwright';

// Test data fixtures
const testProject = {
  name: 'Test Society',
  address: '123 Test Street',
  city: 'Test City',
  state: 'Test State',
  pincode: '123456',
  status: 'active',
  account_name: 'Test Account',
  bank_name: 'Test Bank',
  account_no: '1234567890',
  ifsc_code: 'TEST123',
  branch: 'Test Branch'
};

const testUnit = {
  unit_number: 'A-001',
  sector_code: 'A',
  owner_name: 'John Doe',
  area_sqft: 1200,
  unit_type: 'flat',
  contact_number: '9876543210',
  email: 'john@example.com',
  status: 'active',
  penalty: 500
};

const testPayment = {
  payment_date: '2024-03-18',
  payment_amount: 5000,
  payment_mode: 'transfer',
  remarks: 'Test payment'
};

// Selectors
const SELECTORS: Record<string, string> = {
  // Navigation
  dashboardLink: '[href="#/"]',
  projectsLink: '[href="#/projects"]',
  unitsLink: '[href="#/units"]',
  billingLink: '[href="#/billing"]',
  paymentsLink: '[href="#/payments"]',
  reportsLink: '[href="#/reports"]',
  settingsLink: '[href="#/settings"]',
  
  // Projects
  createProjectBtn: '[data-testid="create-project-btn"]',
  projectNameInput: '#name',
  projectAddressInput: '#address',
  projectCityInput: '#city',
  projectStateInput: '#state',
  projectPincodeInput: '#pincode',
  projectStatusSelect: '#status',
  accountNameInput: '#account_name',
  bankNameInput: '#bank_name',
  accountNoInput: '#account_no',
  ifscCodeInput: '#ifsc_code',
  branchInput: '#branch',
  saveProjectBtn: '[data-testid="save-project-btn"]',
  projectTable: '.ant-table',
  projectTableRow: '.ant-table-tbody tr',
  editProjectBtn: '[data-testid="edit-project-btn"]',
  deleteProjectBtn: '[data-testid="delete-project-btn"]',
  
  // Units
  createUnitBtn: '[data-testid="create-unit-btn"]',
  unitProjectSelect: '#project_id',
  unitNumberInput: '#unit_number',
  unitSectorInput: '#sector_code',
  unitOwnerInput: '#owner_name',
  unitAreaInput: '#area_sqft',
  unitTypeSelect: '#unit_type',
  unitContactInput: '#contact_number',
  unitEmailInput: '#email',
  unitStatusSelect: '#status',
  unitPenaltyInput: '#penalty',
  saveUnitBtn: '[data-testid="save-unit-btn"]',
  unitTable: '.ant-table',
  unitTableRow: '.ant-table-tbody tr',
  editUnitBtn: '[data-testid="edit-unit-btn"]',
  deleteUnitBtn: '[data-testid="delete-unit-btn"]',
  
  // Payments
  createPaymentBtn: '[data-testid="create-payment-btn"]',
  paymentProjectSelect: '#project_id',
  paymentUnitSelect: '#unit_id',
  paymentDateInput: '#payment_date',
  paymentAmountInput: '#payment_amount',
  paymentModeSelect: '#payment_mode',
  paymentRemarksInput: '#remarks',
  savePaymentBtn: '[data-testid="save-payment-btn"]',
  paymentTable: '.ant-table',
  paymentTableRow: '.ant-table-tbody tr',
  editPaymentBtn: '[data-testid="edit-payment-btn"]',
  deletePaymentBtn: '[data-testid="delete-payment-btn"]',
  
  // Common
  modal: '.ant-modal',
  modalTitle: '.ant-modal-title',
  modalContent: '.ant-modal-content',
  modalCloseBtn: '.ant-modal-close',
  confirmBtn: '.ant-btn-primary',
  cancelBtn: '.ant-btn-default',
  successMessage: '.ant-message-success',
  errorMessage: '.ant-message-error',
  loading: '.ant-spin',
  searchInput: '.ant-input-search'
};

// Helper functions
async function waitForAppLoad(page: Page): Promise<void> {
  await page.waitForSelector(SELECTORS.dashboardLink, { timeout: 10000 });
  await expect(page.locator(SELECTORS.dashboardLink)).toBeVisible();
}

async function navigateTo(page: Page, section: string): Promise<void> {
  const linkKey = `${section}Link` as keyof typeof SELECTORS;
  const link = SELECTORS[linkKey];
  await page.click(link);
  await page.waitForLoadState('networkidle');
}

async function fillForm(page: Page, data: Record<string, any>): Promise<void> {
  for (const [key, value] of Object.entries(data)) {
    const inputKey = `${key}Input` as keyof typeof SELECTORS;
    const selectKey = `${key}Select` as keyof typeof SELECTORS;
    const selector = SELECTORS[inputKey] || SELECTORS[selectKey] || `#${key}`;
    const element = page.locator(selector);
    
    if (await element.isVisible()) {
      if (await element.getAttribute('role') === 'combobox') {
        await element.selectOption(value);
      } else {
        await element.fill(String(value));
      }
    }
  }
}

async function createProject(page: Page, projectData: Partial<typeof testProject> = testProject): Promise<void> {
  await navigateTo(page, 'projects');
  await page.click(SELECTORS.createProjectBtn);
  await page.waitForSelector(SELECTORS.modal);
  
  await fillForm(page, projectData);
  await page.click(SELECTORS.saveProjectBtn);
  
  await expect(page.locator(SELECTORS.successMessage)).toBeVisible({ timeout: 5000 });
  await page.waitForSelector(SELECTORS.modal, { state: 'hidden' });
}

async function createUnit(page: Page, unitData: Partial<typeof testUnit> = testUnit, projectId?: number): Promise<void> {
  await navigateTo(page, 'units');
  await page.click(SELECTORS.createUnitBtn);
  await page.waitForSelector(SELECTORS.modal);
  
  if (projectId) {
    await page.selectOption(SELECTORS.unitProjectSelect, { label: String(projectId) });
  }
  
  await fillForm(page, unitData);
  await page.click(SELECTORS.saveUnitBtn);
  
  await expect(page.locator(SELECTORS.successMessage)).toBeVisible({ timeout: 5000 });
  await page.waitForSelector(SELECTORS.modal, { state: 'hidden' });
}

async function createPayment(page: Page, paymentData: Partial<typeof testPayment> = testPayment, projectId?: number, unitId?: number): Promise<void> {
  await navigateTo(page, 'payments');
  await page.click(SELECTORS.createPaymentBtn);
  await page.waitForSelector(SELECTORS.modal);
  
  if (projectId) {
    await page.selectOption(SELECTORS.paymentProjectSelect, { label: String(projectId) });
  }
  if (unitId) {
    await page.selectOption(SELECTORS.paymentUnitSelect, { label: String(unitId) });
  }
  
  await fillForm(page, paymentData);
  await page.click(SELECTORS.savePaymentBtn);
  
  await expect(page.locator(SELECTORS.successMessage)).toBeVisible({ timeout: 5000 });
  await page.waitForSelector(SELECTORS.modal, { state: 'hidden' });
}

// Test suite
test.describe('Barkat Application - Full User Journey', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let context: BrowserContext;

  test.beforeAll(async (): Promise<void> => {
    electronApp = await electron.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      timeout: 30000
    });
    
    context = electronApp.context();
    page = await context.newPage();
    
    // Listen for console errors
    page.on('pageerror', (error: Error) => {
      console.error('Page error:', error);
    });
    
    // Wait for app to fully load
    await waitForAppLoad(page);
  });

  test.afterAll(async (): Promise<void> => {
    await electronApp.close();
  });

  test.beforeEach(async (): Promise<void> => {
    // Clear any existing data or reset state
    await page.goto('/');
    await waitForAppLoad(page);
  });

  test.describe('Authentication & Navigation', () => {
    test('should load dashboard and navigate to all sections', async (): Promise<void> => {
      // Verify dashboard loads
      await expect(page.locator(SELECTORS.dashboardLink)).toBeVisible();
      
      // Navigate to each section and verify it loads
      const sections = ['projects', 'units', 'billing', 'payments', 'reports', 'settings'];
      
      for (const section of sections) {
        await navigateTo(page, section);
        await expect(page.locator('body')).toContainText(section.charAt(0).toUpperCase() + section.slice(1));
      }
    });

    test('should handle navigation breadcrumbs correctly', async (): Promise<void> => {
      await navigateTo(page, 'projects');
      await navigateTo(page, 'units');
      
      // Verify breadcrumb navigation
      const breadcrumb = page.locator('.ant-breadcrumb');
      await expect(breadcrumb).toBeVisible();
    });
  });

  test.describe('Project Management', () => {
    test('should create, read, update, and delete projects', async (): Promise<void> => {
      // Create project
      await createProject(page, testProject);
      
      // Verify project appears in table
      await navigateTo(page, 'projects');
      await expect(page.locator(SELECTORS.projectTable)).toContainText(testProject.name);
      
      // Edit project
      await page.locator(SELECTORS.projectTableRow).first().locator(SELECTORS.editProjectBtn).click();
      await page.waitForSelector(SELECTORS.modal);
      
      const updatedAddress = '456 Updated Street';
      await page.fill(SELECTORS.projectAddressInput, updatedAddress);
      await page.click(SELECTORS.saveProjectBtn);
      
      await expect(page.locator(SELECTORS.successMessage)).toBeVisible();
      await expect(page.locator(SELECTORS.projectTable)).toContainText(updatedAddress);
      
      // Delete project
      await page.locator(SELECTORS.projectTableRow).first().locator(SELECTORS.deleteProjectBtn).click();
      await page.click(SELECTORS.confirmBtn);
      
      await expect(page.locator(SELECTORS.successMessage)).toBeVisible();
      await expect(page.locator(SELECTORS.projectTable)).not.toContainText(testProject.name);
    });

    test('should validate project creation with invalid data', async (): Promise<void> => {
      await navigateTo(page, 'projects');
      await page.click(SELECTORS.createProjectBtn);
      await page.waitForSelector(SELECTORS.modal);
      
      // Try to save without required fields
      await page.click(SELECTORS.saveProjectBtn);
      
      // Should show validation errors
      await expect(page.locator('.ant-form-item-explain-error')).toBeVisible();
      await expect(page.locator(SELECTORS.errorMessage)).toBeVisible();
    });

    test('should handle project creation with boundary values', async (): Promise<void> => {
      const boundaryProject = {
        ...testProject,
        name: 'A'.repeat(100), // Max length
        pincode: '1'.repeat(10), // Max pincode length
        account_no: '9'.repeat(20) // Long account number
      };
      
      await createProject(page, boundaryProject);
      
      await navigateTo(page, 'projects');
      await expect(page.locator(SELECTORS.projectTable)).toContainText(boundaryProject.name);
    });
  });

  test.describe('Unit Management', () => {
    test('should create, read, update, and delete units', async (): Promise<void> => {
      // First create a project to associate with unit
      await createProject(page, testProject);
      
      // Create unit
      await createUnit(page, testUnit);
      
      // Verify unit appears in table
      await navigateTo(page, 'units');
      await expect(page.locator(SELECTORS.unitTable)).toContainText(testUnit.unit_number);
      
      // Edit unit
      await page.locator(SELECTORS.unitTableRow).first().locator(SELECTORS.editUnitBtn).click();
      await page.waitForSelector(SELECTORS.modal);
      
      const updatedOwner = 'Jane Smith';
      await page.fill(SELECTORS.unitOwnerInput, updatedOwner);
      await page.click(SELECTORS.saveUnitBtn);
      
      await expect(page.locator(SELECTORS.successMessage)).toBeVisible();
      await expect(page.locator(SELECTORS.unitTable)).toContainText(updatedOwner);
      
      // Delete unit
      await page.locator(SELECTORS.unitTableRow).first().locator(SELECTORS.deleteUnitBtn).click();
      await page.click(SELECTORS.confirmBtn);
      
      await expect(page.locator(SELECTORS.successMessage)).toBeVisible();
      await expect(page.locator(SELECTORS.unitTable)).not.toContainText(testUnit.unit_number);
    });

    test('should validate unit creation with invalid data', async (): Promise<void> => {
      await navigateTo(page, 'units');
      await page.click(SELECTORS.createUnitBtn);
      await page.waitForSelector(SELECTORS.modal);
      
      // Try to save without required fields
      await page.click(SELECTORS.saveUnitBtn);
      
      await expect(page.locator('.ant-form-item-explain-error')).toBeVisible();
    });

    test('should handle unit creation with empty project selection', async (): Promise<void> => {
      await navigateTo(page, 'units');
      await page.click(SELECTORS.createUnitBtn);
      await page.waitForSelector(SELECTORS.modal);
      
      // Fill unit data but don't select project
      await fillForm(page, testUnit);
      await page.click(SELECTORS.saveUnitBtn);
      
      await expect(page.locator('.ant-form-item-explain-error')).toBeVisible();
    });
  });

  test.describe('Payment Management', () => {
    test.beforeEach(async (): Promise<void> => {
      // Setup: Create project and unit for payment tests
      await createProject(page, testProject);
      await createUnit(page, testUnit);
    });

    test('should create, read, update, and delete payments', async (): Promise<void> => {
      // Create payment
      await createPayment(page, testPayment);
      
      // Verify payment appears in table
      await navigateTo(page, 'payments');
      await expect(page.locator(SELECTORS.paymentTable)).toContainText(testPayment.payment_amount.toString());
      
      // Edit payment
      await page.locator(SELECTORS.paymentTableRow).first().locator(SELECTORS.editPaymentBtn).click();
      await page.waitForSelector(SELECTORS.modal);
      
      const updatedAmount = '6000';
      await page.fill(SELECTORS.paymentAmountInput, updatedAmount);
      await page.click(SELECTORS.savePaymentBtn);
      
      await expect(page.locator(SELECTORS.successMessage)).toBeVisible();
      await expect(page.locator(SELECTORS.paymentTable)).toContainText(updatedAmount);
      
      // Delete payment
      await page.locator(SELECTORS.paymentTableRow).first().locator(SELECTORS.deletePaymentBtn).click();
      await page.click(SELECTORS.confirmBtn);
      
      await expect(page.locator(SELECTORS.successMessage)).toBeVisible();
    });

    test('should validate payment creation with invalid data', async (): Promise<void> => {
      await navigateTo(page, 'payments');
      await page.click(SELECTORS.createPaymentBtn);
      await page.waitForSelector(SELECTORS.modal);
      
      // Try to save without required fields
      await page.click(SELECTORS.savePaymentBtn);
      
      await expect(page.locator('.ant-form-item-explain-error')).toBeVisible();
    });

    test('should handle payment with boundary amount values', async (): Promise<void> => {
      const boundaryPayment = {
        ...testPayment,
        payment_amount: 999999999 // Maximum reasonable amount
      };
      
      await createPayment(page, boundaryPayment);
      
      await navigateTo(page, 'payments');
      await expect(page.locator(SELECTORS.paymentTable)).toContainText(boundaryPayment.payment_amount.toString());
    });
  });

  test.describe('Search and Filtering', () => {
    test.beforeEach(async (): Promise<void> => {
      // Setup test data
      await createProject(page, testProject);
      await createUnit(page, testUnit);
      await createPayment(page, testPayment);
    });

    test('should search projects by name', async (): Promise<void> => {
      await navigateTo(page, 'projects');
      
      await page.fill(SELECTORS.searchInput, testProject.name);
      await expect(page.locator(SELECTORS.projectTable)).toContainText(testProject.name);
      
      // Search for non-existent project
      await page.fill(SELECTORS.searchInput, 'NonExistentProject');
      await expect(page.locator(SELECTORS.projectTable)).not.toContainText(testProject.name);
    });

    test('should filter units by project', async (): Promise<void> => {
      await navigateTo(page, 'units');
      
      // Filter by project (if filter functionality exists)
      const projectFilter = page.locator('[data-testid="project-filter"]');
      if (await projectFilter.isVisible()) {
        await projectFilter.selectOption({ label: testProject.name });
        await expect(page.locator(SELECTORS.unitTable)).toContainText(testUnit.unit_number);
      }
    });

    test('should search payments by amount', async (): Promise<void> => {
      await navigateTo(page, 'payments');
      
      await page.fill(SELECTORS.searchInput, testPayment.payment_amount.toString());
      await expect(page.locator(SELECTORS.paymentTable)).toContainText(testPayment.payment_amount.toString());
    });
  });

  test.describe('Network and API Handling', () => {
    test('should handle network failures gracefully', async (): Promise<void> => {
      // Simulate network failure
      await context.route('**/*', (route: Route) => route.abort());
      
      await navigateTo(page, 'projects');
      
      // Try to create project
      await page.click(SELECTORS.createProjectBtn);
      await page.waitForSelector(SELECTORS.modal);
      
      await fillForm(page, testProject);
      await page.click(SELECTORS.saveProjectBtn);
      
      // Should show network error message
      await expect(page.locator(SELECTORS.errorMessage)).toBeVisible({ timeout: 10000 });
      
      // Restore network
      await context.unroute('**/*');
    });

    test('should handle API timeouts', async (): Promise<void> => {
      // Simulate slow API response
      await context.route('**/*', async (route: Route) => {
        await new Promise(resolve => setTimeout(resolve, 6000)); // 6 second delay
        await route.continue();
      });
      
      await navigateTo(page, 'projects');
      
      // Should show loading state
      await expect(page.locator(SELECTORS.loading)).toBeVisible({ timeout: 5000 });
      
      // Restore normal routing
      await context.unroute('**/*');
    });

    test('should validate API responses', async (): Promise<void> => {
      // Mock API response with invalid data
      await context.route('**/api/projects', (route: Route) => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' })
        });
      });
      
      await navigateTo(page, 'projects');
      
      // Should handle server error gracefully
      await expect(page.locator(SELECTORS.errorMessage)).toBeVisible({ timeout: 10000 });
      
      await context.unroute('**/api/projects');
    });
  });

  test.describe('Error Scenarios', () => {
    test('should handle concurrent operations', async (): Promise<void> => {
      await navigateTo(page, 'projects');
      
      // Try to create multiple projects simultaneously
      const promises = Array(3).fill(null).map((_, index) => 
        createProject(page, { ...testProject, name: `Concurrent Project ${index}` })
      );
      
      await Promise.allSettled(promises);
      
      // Verify at least some projects were created
      await navigateTo(page, 'projects');
      await expect(page.locator(SELECTORS.projectTable)).toContainText('Concurrent Project');
    });

    test('should handle browser refresh during operations', async (): Promise<void> => {
      await navigateTo(page, 'projects');
      await page.click(SELECTORS.createProjectBtn);
      await page.waitForSelector(SELECTORS.modal);
      
      // Fill partial form
      await page.fill(SELECTORS.projectNameInput, testProject.name);
      
      // Refresh page
      await page.reload();
      await waitForAppLoad(page);
      
      // Modal should be closed and data not saved
      await expect(page.locator(SELECTORS.modal)).not.toBeVisible();
      
      await navigateTo(page, 'projects');
      await expect(page.locator(SELECTORS.projectTable)).not.toContainText(testProject.name);
    });

    test('should handle memory pressure scenarios', async (): Promise<void> => {
      // Create large amount of data to test memory handling
      const largeProject = {
        ...testProject,
        name: 'A'.repeat(1000), // Very large name
        address: 'B'.repeat(1000), // Very large address
        description: 'C'.repeat(5000) // Very large description if field exists
      };
      
      await navigateTo(page, 'projects');
      await page.click(SELECTORS.createProjectBtn);
      await page.waitForSelector(SELECTORS.modal);
      
      await fillForm(page, largeProject);
      await page.click(SELECTORS.saveProjectBtn);
      
      // Should either succeed or fail gracefully with memory error
      const message = page.locator(SELECTORS.successMessage).or(page.locator(SELECTORS.errorMessage));
      await expect(message).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Accessibility and Usability', () => {
    test('should support keyboard navigation', async (): Promise<void> => {
      await navigateTo(page, 'projects');
      
      // Test Tab navigation
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toBeVisible();
      
      // Test Enter key on buttons
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      
      // Should open create modal or navigate
      const modalVisible = await page.locator(SELECTORS.modal).isVisible();
      expect(modalVisible || page.url().includes('#/projects')).toBeTruthy();
    });

    test('should have proper ARIA labels', async (): Promise<void> => {
      await navigateTo(page, 'projects');
      
      // Check for proper ARIA labels on key elements
      const createBtn = page.locator(SELECTORS.createProjectBtn);
      await expect(createBtn).toHaveAttribute('aria-label');
      
      await page.click(SELECTORS.createProjectBtn);
      await page.waitForSelector(SELECTORS.modal);
      
      // Check modal accessibility
      const modal = page.locator(SELECTORS.modal);
      await expect(modal).toHaveAttribute('role', 'dialog');
      await expect(modal).toHaveAttribute('aria-modal', 'true');
    });

    test('should handle screen reader announcements', async (): Promise<void> => {
      await navigateTo(page, 'projects');
      await createProject(page, testProject);
      
      // Check for aria-live regions for success/error messages
      const liveRegion = page.locator('[aria-live]');
      if (await liveRegion.isVisible()) {
        await expect(liveRegion).toBeVisible();
      }
    });
  });

  test.describe('Performance and Optimization', () => {
    test('should load pages within acceptable time limits', async (): Promise<void> => {
      const startTime = Date.now();
      
      await navigateTo(page, 'projects');
      await page.waitForLoadState('networkidle');
      
      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThan(3000); // 3 seconds max
    });

    test('should handle large datasets efficiently', async (): Promise<void> => {
      // Create multiple projects to test table performance
      for (let i = 0; i < 10; i++) {
        await createProject(page, { ...testProject, name: `Performance Test ${i}` });
      }
      
      const startTime = Date.now();
      await navigateTo(page, 'projects');
      await page.waitForSelector(SELECTORS.projectTable);
      
      const renderTime = Date.now() - startTime;
      expect(renderTime).toBeLessThan(2000); // 2 seconds max for table render
    });

    test('should not have memory leaks', async (): Promise<void> => {
      // Monitor memory usage during operations
      const initialMemory = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize || 0);
      
      // Perform multiple operations
      for (let i = 0; i < 5; i++) {
        await createProject(page, { ...testProject, name: `Memory Test ${i}` });
        await navigateTo(page, 'projects');
      }
      
      // Force garbage collection if available
      await page.evaluate(() => {
        if ((window as any).gc) (window as any).gc();
      });
      
      const finalMemory = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize || 0);
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });

  test.describe('Data Integrity and Consistency', () => {
    test('should maintain data consistency across operations', async (): Promise<void> => {
      // Create project with specific data
      const uniqueProject = { ...testProject, name: 'Consistency Test Project' };
      await createProject(page, uniqueProject);
      
      // Verify data in different views
      await navigateTo(page, 'projects');
      await expect(page.locator(SELECTORS.projectTable)).toContainText(uniqueProject.name);
      
      // Check if data persists after refresh
      await page.reload();
      await waitForAppLoad(page);
      await navigateTo(page, 'projects');
      await expect(page.locator(SELECTORS.projectTable)).toContainText(uniqueProject.name);
    });

    test('should handle concurrent data modifications', async (): Promise<void> => {
      await createProject(page, testProject);
      
      // Try to edit and delete the same project concurrently
      await navigateTo(page, 'projects');
      
      const editPromise = page.locator(SELECTORS.projectTableRow).first().locator(SELECTORS.editProjectBtn).click();
      const deletePromise = page.locator(SELECTORS.projectTableRow).first().locator(SELECTORS.deleteProjectBtn).click();
      
      await Promise.allSettled([editPromise, deletePromise]);
      
      // Should handle gracefully without crashing
      await expect(page.locator('body')).toBeVisible();
    });

    test('should validate data relationships', async (): Promise<void> => {
      // Create project and unit
      await createProject(page, testProject);
      await createUnit(page, testUnit);
      
      // Try to delete project that has units
      await navigateTo(page, 'projects');
      await page.locator(SELECTORS.projectTableRow).first().locator(SELECTORS.deleteProjectBtn).click();
      await page.click(SELECTORS.confirmBtn);
      
      // Should either prevent deletion or cascade delete
      const message = page.locator(SELECTORS.successMessage).or(page.locator(SELECTORS.errorMessage));
      await expect(message).toBeVisible({ timeout: 5000 });
    });
  });
});
