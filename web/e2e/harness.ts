import { expect, type Locator, type Page } from '@playwright/test'

export type HarnessLaunchOptions = {
  deterministic?: boolean
  mock?: boolean
  fixture?: string
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Page object for driving the Fork web UI in deterministic test mode.
 */
export class ForkHarness {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  private async openSystemsDialog() {
    if ((await this.page.getByRole('dialog').count()) > 0) return
    await this.page.waitForSelector(
      '[data-testid="open-systems"], [data-testid="open-systems-empty"]',
      { state: 'visible' }
    )
    if (await this.page.getByTestId('open-systems').isVisible()) {
      await this.page.getByTestId('open-systems').click()
    } else {
      await this.page.getByTestId('open-systems-empty').click()
    }
    await this.page.getByRole('dialog').waitFor()
  }

  async goto(options: HarnessLaunchOptions = {}) {
    const params = new URLSearchParams()
    const deterministic = options.deterministic ?? true
    const mock = options.mock ?? true

    if (deterministic) params.set('test', '1')
    if (mock) params.set('mock', '1')
    if (options.fixture) params.set('fixture', options.fixture)

    const query = params.toString()
    await this.page.goto(query ? `/?${query}` : '/')
  }

  async createSystem(name: string) {
    await this.openSystemsDialog()
    await this.page.getByTestId('system-name-input').fill(name)
    await this.page.getByTestId('create-system').click()
    await this.page.getByTestId('workspace').waitFor()
  }

  async openSystem(name: string) {
    await this.openSystemsDialog()
    await this.page.getByRole('dialog').getByRole('button', { name, exact: true }).click()
    await this.page.getByTestId('workspace').waitFor()
  }

  async createScene() {
    await this.page.getByTestId('viewport-insert-empty').click()
    await this.page.getByTestId('viewport-create-scene').click()
    await this.page.getByTestId('viewport-workspace').waitFor()
  }

  async openDisclosure(testId: string) {
    const summary = this.page.getByTestId(testId)
    await summary.waitFor({ state: 'visible' })
    const details = summary.locator('..')
    const isOpen = await details.evaluate((node) => (node as HTMLDetailsElement).open)
    if (isOpen) return
    await summary.click()
    await expect(details).toHaveJSProperty('open', true)
  }

  async createOrbit() {
    await this.page.getByTestId('create-object-button').click()
    await this.page.getByTestId('create-object-menu').waitFor()
    await this.page.getByTestId('create-orbit').click()
  }

  async createEquilibrium() {
    await this.page.getByTestId('create-object-button').click()
    await this.page.getByTestId('create-object-menu').waitFor()
    await this.page.getByTestId('create-equilibrium').click()
  }

  async runOrbit() {
    await this.page.getByTestId('orbit-run-toggle').click()
    await this.page.getByTestId('orbit-run-submit').click()
  }

  async solveEquilibrium() {
    await this.page.getByTestId('equilibrium-solver-toggle').click()
    await this.page.getByTestId('equilibrium-solve-submit').click()
  }

  async selectTreeNode(label: string) {
    const pattern = new RegExp(`^${escapeRegex(label)}`, 'i')
    await this.page
      .locator('[data-testid^="object-tree-node-"]')
      .filter({ hasText: pattern })
      .first()
      .click()
  }

  inspectorName(): Locator {
    return this.page.getByTestId('inspector-name')
  }

  systemNameInput(): Locator {
    return this.page.getByTestId('system-name')
  }
}

export function createHarness(page: Page) {
  return new ForkHarness(page)
}
