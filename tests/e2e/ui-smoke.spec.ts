import fs from 'fs'
import path from 'path'
import { test, expect, Page } from '@playwright/test'
import { ElectronApplication, _electron as electron } from 'playwright'

// `require('electron')` resolves to the local Electron binary path in Node.
// This keeps Playwright aligned with the app's installed Electron runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBinaryPath = require('electron')
const APP_ENTRY = path.resolve(__dirname, '..', '..')
const TEST_DATA_DIR = path.join(process.cwd(), '.playwright-smoke', String(Date.now()))
const TEST_DB_PATH = path.join(TEST_DATA_DIR, 'barkat.e2e.db')

async function getMainWindow(app: ElectronApplication): Promise<Page> {
  const existingWindows = app.windows()
  const page =
    existingWindows.length > 0
      ? existingWindows[0]
      : await app.firstWindow({ timeout: 120000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.app-shell-menu', { timeout: 60000 })
  return page
}

async function openSection(page: Page, navLabel: string, headerText: string): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {})
  await page.locator('.app-shell-menu').getByText(navLabel, { exact: true }).click()
  await expect(page.locator('.app-shell-header-title')).toContainText(headerText)
  await expect(page.locator('.page-screen, .responsive-page-container').first()).toBeVisible()
}

test.describe('Barkat UI smoke', () => {
  test.describe.configure({ mode: 'serial' })

  let electronApp: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    test.setTimeout(120000)
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true })

    electronApp = await electron.launch({
      executablePath: electronBinaryPath,
      args: [APP_ENTRY],
      env: {
        ...process.env,
        BARKAT_DB_PATH: TEST_DB_PATH,
        BARKAT_USER_DATA_PATH: TEST_DATA_DIR,
        NODE_ENV: 'test'
      },
      timeout: 120000
    })
    page = await getMainWindow(electronApp)
  })

  test.afterAll(async () => {
    await electronApp?.close()
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true })
    }
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
      await openSection(page, section.nav, section.header)
    }
  })

  test('shows primary actions on main operational pages', async () => {
    await openSection(page, 'Projects', 'Projects')
    await expect(page.getByRole('button', { name: 'Add Project' })).toBeVisible()

    await openSection(page, 'Units', 'Units')
    await expect(page.getByRole('button', { name: 'Add Unit' })).toBeVisible()

    await openSection(page, 'Maintenance Letters', 'Maintenance Letters')
    await expect(page.getByRole('button', { name: 'Generate Maintenance Letters' })).toBeVisible()

    await openSection(page, 'Payments & Receipts', 'Payments & Receipts')
    await expect(page.getByRole('button', { name: 'Record new payment' })).toBeVisible()
  })

  test('shows shared filter/search UI on list pages', async () => {
    const filterPages = ['Projects', 'Units', 'Maintenance Letters', 'Payments & Receipts', 'Reports']

    for (const label of filterPages) {
      await openSection(page, label, label)
      await expect(page.locator('.app-filter-panel-label')).toContainText('Refine results')
      await expect(page.locator('.app-search-field').first()).toBeVisible()
    }
  })
})
