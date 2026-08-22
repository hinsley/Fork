import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

test.describe.configure({ mode: 'serial' })
// Each test drives real wasm computations (orbit settling, entropy runs over
// thousands of steps) and CI runs the suite beside other spec workers, so the
// default thirty-second test budget is too tight.
test.setTimeout(180_000)
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

async function returnToWorkflowOverview(page: Page) {
  // Re-opening a system restores the object's last focused workflow, so the
  // actions-bar toggles may not exist until we walk back out of it.
  for (let depth = 0; depth < 8; depth++) {
    const back = page.getByTestId('inspector-workflow-back')
    if ((await back.count()) === 0) return
    await back.click()
    await expect(back).toHaveCount(0)
  }
}

async function openStateGridSetup(page: Page) {
  await returnToWorkflowOverview(page)
  await page.getByTestId('action-state-grid-setup-toggle').click()
}

async function openExpansionEntropy(page: Page) {
  await returnToWorkflowOverview(page)
  await page.getByTestId('action-state-grid-entropy-toggle').click()
}

/**
 * After reopening a system and re-selecting its State Grid node the app may
 * land either directly inside the restored expansion-entropy workflow (with
 * the previous estimate shown) or on the workflow overview, depending on how
 * hydration races with selection. Wait for either state and make sure the
 * entropy panel with its persisted estimate ends up visible.
 */
async function expectRestoredEntropyResult(page: Page) {
  const estimate = page.getByTestId('state-grid-final-estimate')
  await expect
    .poll(
      async () =>
        (await estimate.count()) > 0 ||
        (await page.getByTestId('action-state-grid-entropy-toggle').count()) > 0,
      { timeout: 30_000 }
    )
    .toBe(true)
  if ((await estimate.count()) === 0) await openExpansionEntropy(page)
  await expect(estimate).toBeVisible()
}

async function leaveStateGridWorkflow(page: Page) {
  await page.getByTestId('inspector-workflow-back').click()
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
  await openStateGridSetup(page)
  await expect(page.getByTestId('state-grid-total-points')).toHaveText('25')
  await page.getByTestId('state-grid-x-resolution').fill('3')
  await page.getByTestId('state-grid-y-resolution').fill('3')
  await expect(page.getByTestId('state-grid-total-points')).toHaveText('9')
  await expect(page.getByTestId('state-grid-workload')).toContainText('4,500')

  await leaveStateGridWorkflow(page)
  await openExpansionEntropy(page)
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
  await expect(page.getByTestId('state-grid-expansion-entropy-result')).toContainText(
    'Rust/WASM workers'
  )
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
  // Re-selecting the object restores its last focused workflow (expansion
  // entropy) directly, with the previous result still displayed.
  await expectRestoredEntropyResult(page)
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

  await openStateGridSetup(page)
  await page.getByTestId('state-grid-x-resolution').fill('1')
  await page.getByTestId('state-grid-y-resolution').fill('1')
  await leaveStateGridWorkflow(page)
  await openExpansionEntropy(page)
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
  // Re-selection restores the expansion-entropy focus directly; the persisted
  // estimate must still be shown without re-running.
  await expectRestoredEntropyResult(page)
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
  await openStateGridSetup(page)
  await page.getByTestId('state-grid-x-resolution').fill('3')
  await page.getByTestId('state-grid-y-resolution').fill('3')
  await leaveStateGridWorkflow(page)
  await openExpansionEntropy(page)
  await page.getByTestId('state-grid-entropy-steps').fill('10')
  await page.getByTestId('state-grid-entropy-checkpoint-stride').fill('2')
  await page.getByTestId('state-grid-run-expansion-entropy').click()

  await expect(page.getByTestId('state-grid-final-estimate')).toHaveText('0.00000', {
    timeout: 30_000,
  })
  await expect(page.getByTestId('state-grid-expansion-entropy-result')).toContainText('9 / 9')
})
