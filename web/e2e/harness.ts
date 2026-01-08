import type { Locator, Page } from '@playwright/test'

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
    await this.page.getByTestId('system-name-input').fill(name)
    await this.page.getByTestId('create-system').click()
    await this.page.getByTestId('workspace').waitFor()
  }

  async createOrbit() {
    await this.page.getByTestId('create-object-button').click()
    await this.page.getByTestId('create-orbit').click()
  }

  async createEquilibrium() {
    await this.page.getByTestId('create-object-button').click()
    await this.page.getByTestId('create-equilibrium').click()
  }

  async runOrbit() {
    await this.page.getByTestId('orbit-run-submit').click()
  }

  async solveEquilibrium() {
    await this.page.getByTestId('equilibrium-solve-submit').click()
  }

  async selectTreeNode(label: string) {
    await this.page.getByRole('button', { name: new RegExp(escapeRegex(label), 'i') }).click()
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
