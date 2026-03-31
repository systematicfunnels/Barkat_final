import { test, expect, Page } from '@playwright/test'
import { ElectronApplication, _electron as electron } from 'playwright'

// `require('electron')` resolves to the local Electron binary path in Node.
// This keeps Playwright aligned with the app's installed Electron runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBinaryPath = require('electron')
const APP_ENTRY = '.'

async function getMainWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.waitForEvent('window', { timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)
  return page
}

test.describe('Barkat UI smoke', () => {
  let electronApp: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    test.setTimeout(120000)
    electronApp = await electron.launch({
      executablePath: electronBinaryPath,
      args: [APP_ENTRY],
      timeout: 120000
    })
    page = await getMainWindow(electronApp)
  })

  test.afterAll(async () => {
    await electronApp?.close()
  })

  test('loads shell and all major sections', async () => {
    await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible()
    await expect(page.locator('.app-shell-header-title')).toContainText('Dashboard')

    const sections = [
      { nav: 'Projects', header: 'Projects' },
      { nav: 'Units', header: 'Units' },
      { nav: 'Maintenance Letters', header: 'Maintenance Letters' },
      { nav: 'Payments & Receipts', header: 'Payments & Receipts' },
      { nav: 'Reports', header: 'Reports' },
      { nav: 'Settings', header: 'Settings' }
    ]

    for (const section of sections) {
      await page.locator('.app-shell-menu').getByText(section.nav, { exact: true }).click()
      await expect(page.locator('.app-shell-header-title')).toContainText(section.header)
      await expect(page.locator('.page-screen, .responsive-page-container').first()).toBeVisible()
    }
  })

  test('shows primary actions on main operational pages', async () => {
    await page.locator('.app-shell-menu').getByText('Projects', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Add Project' })).toBeVisible()

    await page.locator('.app-shell-menu').getByText('Units', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Add Unit' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import Excel' })).toBeVisible()

    await page.locator('.app-shell-menu').getByText('Maintenance Letters', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Generate Maintenance Letters' })).toBeVisible()

    await page.locator('.app-shell-menu').getByText('Payments & Receipts', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Record Payment' })).toBeVisible()
  })

  test('shows shared filter/search UI on list pages', async () => {
    const filterPages = ['Projects', 'Units', 'Maintenance Letters', 'Payments & Receipts', 'Reports']

    for (const label of filterPages) {
      await page.locator('.app-shell-menu').getByText(label, { exact: true }).click()
      await expect(page.locator('.app-filter-panel-label')).toContainText('Refine results')
      await expect(page.locator('.app-search-field').first()).toBeVisible()
    }
  })
})
