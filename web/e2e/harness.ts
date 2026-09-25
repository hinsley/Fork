import { expect, type Locator, type Page } from '@playwright/test'

export type HarnessLaunchOptions = {
  deterministic?: boolean
  mock?: boolean
  fixture?: string
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function revealInspectorAction(page: Page, actionId: string): Promise<Locator> {
  const action = page.getByTestId(actionId)
  await action.waitFor({ state: 'attached' })
  // Header popovers (appearance, parameters, frozen variables) float above the action bar.
  if (await page.locator('.inspector-popover:not([hidden])').count()) {
    await page.keyboard.press('Escape')
  }
  if (!(await action.isVisible())) {
    // Secondary actions live in the inspector's `⋯` overflow menu.
    const more = page.getByTestId('inspector-actions-more')
    if ((await more.count()) && (await more.getAttribute('aria-expanded')) !== 'true') {
      await more.click()
    }
  }
  await action.waitFor({ state: 'visible' })
  return action
}

/** Opens a `<details>` block by its summary test id (no-op when already open). */
export async function expandDetails(page: Page, summaryTestId: string) {
  const summary = page.getByTestId(summaryTestId)
  await summary.waitFor({ state: 'visible' })
  const details = summary.locator('..')
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await summary.click()
  }
  await expect(details).toHaveJSProperty('open', true)
}

export async function clickInspectorAction(page: Page, actionId: string) {
  const action = await revealInspectorAction(page, actionId)
  await action.click()
}

/**
 * Page object for driving the Fork web UI in deterministic test mode.
 */
export class ForkHarness {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  /** The systems list: inline on home, otherwise inside the Systems dialog. */
  private async openSystemsDialog(): Promise<Locator> {
    const library = this.page.getByTestId('system-library')
    await this.page.waitForSelector(
      '[data-testid="open-systems"], [data-testid="system-library"]',
      { state: 'visible' }
    )
    if (!(await library.isVisible())) {
      await this.page.getByTestId('open-systems').click()
      await this.page.getByRole('dialog').waitFor()
    }
    return library
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
    const library = await this.openSystemsDialog()
    await library.getByTestId('system-name-input').fill(name)
    await library.getByTestId('create-system').click()
    await this.page.getByTestId('workspace').waitFor()
  }

  async openSystem(name: string) {
    const library = await this.openSystemsDialog()
    await library.getByRole('button', { name, exact: true }).click()
    await this.page.getByTestId('workspace').waitFor()
  }

  async createScene() {
    await this.page.getByTestId('viewport-insert-empty').click()
    await this.page.getByTestId('viewport-create-scene').click()
    await this.page.getByTestId('viewport-workspace').waitFor()
  }

  async openDisclosure(testId: string) {
    // Branch points render inline on the branch's root page (no workflow page).
    if (testId === 'branch-points-toggle') {
      await this.page.getByTestId('branch-point-panel').waitFor({ state: 'visible' })
      return
    }
    const summary = this.page.getByTestId(testId)
    const action = this.page.getByTestId(`action-${testId}`)
    if (await action.count()) {
      await clickInspectorAction(this.page, `action-${testId}`)
      await expect(summary.locator('..')).toHaveJSProperty('open', true)
      return
    }
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
    await clickInspectorAction(this.page, 'action-orbit-run-toggle')
    await this.page.getByTestId('orbit-run-submit').click()
    await this.page.getByTestId('inspector-workflow-back').click()
  }

  async solveEquilibrium() {
    await clickInspectorAction(this.page, 'action-equilibrium-solver-toggle')
    await this.page.getByTestId('equilibrium-solve-submit').click()
  }

  async selectTreeNode(label: string) {
    const pattern = new RegExp(`^${escapeRegex(label)}(?:\\s|\\(|$)`, 'i')
    await this.page
      .locator('[data-testid^="object-tree-node-"]')
      .and(this.page.getByRole('button', { name: pattern }))
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
