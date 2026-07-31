import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

test.describe.configure({ mode: 'serial' })

async function configureTwoDimensionalMap(
  page: Page,
  equations: [string, string]
) {
  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-type-map').click()
  await page.getByTestId('system-eq-0').fill(equations[0])
  await page.getByTestId('system-eq-1').fill(equations[1])
  await page.getByTestId('system-apply').click()
  await page.getByTestId('close-system-settings').click()
}

test('State Grid computes and restores a flow expansion-entropy convergence result', async ({
  page,
}) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('State_Grid_Entropy')

  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-object-menu').waitFor()
  await page.getByTestId('create-state-grid').click()

  await expect(page.getByTestId('state-grid-inspector')).toBeVisible()
  await expect(page.getByTestId('state-grid-total-points')).toHaveText('25')
  await page.getByTestId('state-grid-x-resolution').fill('3')
  await page.getByTestId('state-grid-y-resolution').fill('3')
  await expect(page.getByTestId('state-grid-total-points')).toHaveText('9')
  await expect(page.getByTestId('state-grid-workload')).toContainText('4,500')

  await page.getByTestId('state-grid-entropy-steps').fill('100')
  await page.getByTestId('state-grid-entropy-dt').fill('0.01')
  await page.getByTestId('state-grid-entropy-checkpoint-stride').fill('20')
  await page.getByTestId('state-grid-entropy-stabilization-stride').fill('10')
  await page.getByTestId('state-grid-run-expansion-entropy').click()

  await expect(page.getByTestId('state-grid-final-estimate')).toBeVisible({
    timeout: 30_000,
  })
  const estimate = Number(await page.getByTestId('state-grid-final-estimate').textContent())
  expect(Math.abs(estimate)).toBeLessThan(1e-6)
  await expect(page.getByTestId('state-grid-expansion-entropy-result')).toContainText('9 / 9')
  await expect(page.getByTestId('state-grid-expansion-entropy-plot')).toBeVisible()
  await expect(page.getByTestId('state-grid-expansion-entropy-plot')).toHaveAttribute(
    'data-trace-count',
    '1'
  )
  await page
    .getByTestId('state-grid-expansion-entropy-plot')
    .locator('.plot-container')
    .waitFor()

  await page.setViewportSize({ width: 1440, height: 1600 })
  await page.locator('.inspector__content').evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({
    path: 'test-results/state-grid-expansion-entropy.png',
    fullPage: true,
  })
  await page.getByTestId('state-grid-inspector').screenshot({
    path: 'test-results/state-grid-expansion-entropy-inspector.png',
  })

  await page.getByTestId('open-systems').click()
  await page.getByRole('button', { name: 'State_Grid_Entropy', exact: true }).click()
  await harness.selectTreeNode('State_Grid_1')
  await expect(page.getByTestId('state-grid-final-estimate')).toBeVisible()
  await expect(page.getByTestId('state-grid-expansion-entropy-result')).toContainText('9 / 9')
})

test('State Grid map entropy matches the analytic diagonal-map value by iteration', async ({
  page,
}) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('State_Grid_Map_Log2')
  await configureTwoDimensionalMap(page, ['2*x', '0.5*y'])

  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-object-menu').waitFor()
  await page.getByTestId('create-state-grid').click()

  await page.getByTestId('state-grid-x-resolution').fill('1')
  await page.getByTestId('state-grid-y-resolution').fill('1')
  await page.getByTestId('state-grid-entropy-steps').fill('12')
  await page.getByTestId('state-grid-entropy-checkpoint-stride').fill('3')
  await expect(page.getByText('Iterations', { exact: true })).toBeVisible()
  await expect(page.getByText('Step size', { exact: true })).toHaveCount(0)
  await page.getByTestId('state-grid-run-expansion-entropy').click()

  await expect(page.getByTestId('state-grid-final-estimate')).toBeVisible({
    timeout: 30_000,
  })
  const estimate = Number(await page.getByTestId('state-grid-final-estimate').textContent())
  expect(Math.abs(estimate - Math.log(2))).toBeLessThan(1e-6)
  await expect(page.getByTestId('state-grid-expansion-entropy-result')).toContainText('1 / 1')
  await expect(page.getByTestId('state-grid-expansion-entropy-result')).toContainText(
    'finite iteration'
  )
  await expect(page.getByTestId('state-grid-expansion-entropy-plot')).toBeVisible()

  await page.getByTestId('open-systems').click()
  await page.getByRole('button', { name: 'State_Grid_Map_Log2', exact: true }).click()
  await harness.selectTreeNode('State_Grid_1')
  await expect(page.getByTestId('state-grid-final-estimate')).toHaveText('0.693147')
})

test('State Grid contracting map has zero expansion estimate', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('State_Grid_Map_Contracting')
  await configureTwoDimensionalMap(page, ['0.5*x', '0.25*y'])

  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-object-menu').waitFor()
  await page.getByTestId('create-state-grid').click()
  await page.getByTestId('state-grid-x-resolution').fill('3')
  await page.getByTestId('state-grid-y-resolution').fill('3')
  await page.getByTestId('state-grid-entropy-steps').fill('10')
  await page.getByTestId('state-grid-entropy-checkpoint-stride').fill('2')
  await page.getByTestId('state-grid-run-expansion-entropy').click()

  await expect(page.getByTestId('state-grid-final-estimate')).toHaveText('0.00000', {
    timeout: 30_000,
  })
  await expect(page.getByTestId('state-grid-expansion-entropy-result')).toContainText('9 / 9')
})
