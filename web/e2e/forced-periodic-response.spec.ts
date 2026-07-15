import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

async function addParameter(page: Page, index: number, name: string, value: string) {
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId(`system-param-${index}`).fill(name)
  await page.getByTestId(`system-param-value-${index}`).fill(value)
}

async function applySystem(page: Page) {
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await expect(page.locator('[data-testid^="system-eq-error-"]')).toHaveCount(0)
  await page.getByTestId('close-system-settings').click()
}

async function createForcedResponse(page: Page) {
  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-object-menu').waitFor()
  await page.getByTestId('create-forced-periodic-response').click()
  await page.getByTestId('action-forced-response-solver-toggle').click()
}

test('solves a real-WASM time-forced flow and preserves autonomous guards', async ({ page }) => {
  test.setTimeout(90_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('Forced_Flow_E2E')

  await page.getByTestId('open-system-settings').click()
  await addParameter(page, 0, 'omega', '2')
  await addParameter(page, 1, 'a', '0.4')
  await page.getByTestId('system-eq-0').fill('-x + a*cos(omega*t)')
  await page.getByTestId('system-eq-1').fill('-y')
  await page.getByTestId('system-periodic-forcing-enabled').check()
  await page.getByTestId('system-forcing-period-expression').fill('tau / omega')
  await applySystem(page)

  await createForcedResponse(page)
  await page.getByTestId('forced-response-period-steps').fill('120')
  await page.getByTestId('forced-response-solve-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-forced-response-data-toggle').click()
  await expect(page.getByText('Forcing period', { exact: true })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText('3.1415927').first()).toBeVisible()
  await expect(page.getByText(/μ1 =/)).toBeVisible()

  await harness.createEquilibrium()
  await page.getByTestId('action-equilibrium-solver-toggle').click()
  await expect(
    page.getByTestId('autonomous-workflow-warning')
  ).toHaveText(
    'This system depends on t. Freeze the equation forcing context before running autonomous analysis.'
  )
  await expect(page.getByTestId('equilibrium-solve-submit')).toBeDisabled()

  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-frozen-variables-toggle').click()
  await page.getByTestId('frozen-equation-context-toggle').check()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-equilibrium-solver-toggle').click()
  await expect(page.getByTestId('equilibrium-solve-submit')).toBeEnabled()
})

test('solves a real-WASM period-two iteration-forced map', async ({ page }) => {
  test.setTimeout(90_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('Forced_Map_E2E')

  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-type-map').click()
  await addParameter(page, 0, 'a', '1')
  await page.getByTestId('system-eq-0').fill('0.5*x + a*cos(pi*n)')
  await page.getByTestId('system-eq-1').fill('0.2*y + 0*n')
  await page.getByTestId('system-periodic-forcing-enabled').check()
  await page.getByTestId('system-forcing-iteration-period').fill('2')
  await applySystem(page)

  await createForcedResponse(page)
  await page.getByTestId('forced-response-phase').fill('1')
  await page.getByTestId('forced-response-solve-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-forced-response-data-toggle').click()
  await expect(page.getByText('Forcing period', { exact: true })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText('Trajectory points')).toBeVisible()
  await expect(page.getByText(/μ1 =/)).toBeVisible()
})
