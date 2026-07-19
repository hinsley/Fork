import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

async function selectMapBranchPoint(page: Page) {
  const harness = createHarness(page)
  if (!(await page.getByTestId('workspace').isVisible())) {
    await harness.openSystem('Map_Normal_Form_E2E')
  }
  await harness.selectTreeNode('Branch: map_pitchfork_points')
  await harness.openDisclosure('branch-points-toggle')
  const branchPoint = page
    .locator('[data-testid^="branch-bifurcation-"]')
    .filter({ hasText: /Branch Point/i })
    .first()
  await expect(branchPoint).toBeVisible({ timeout: 30_000 })
  await branchPoint.click()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-normal-form-workflow-toggle').click()
}

test('computes and persists a real map branch-point normal form in the Inspector', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const harness = createHarness(page)

  // Use browser persistence so the second half proves the coefficient survives
  // a full application reload. The compute client remains the real worker/WASM client.
  await harness.goto({ deterministic: false, mock: false })
  await harness.createSystem('Map_Normal_Form_E2E')

  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-type-map').click()
  for (let index = 0; index < 3; index += 1) {
    await page.getByTestId('system-add-parameter').click()
  }
  await page.getByTestId('system-param-0').fill('mu')
  await page.getByTestId('system-param-value-0').fill('-0.2')
  await page.getByTestId('system-param-1').fill('a')
  await page.getByTestId('system-param-value-1').fill('-0.456')
  await page.getByTestId('system-param-2').fill('c')
  await page.getByTestId('system-param-value-2').fill('-1.234')
  await page.getByTestId('system-eq-0').fill('x+mu*a*x+c*x^3')
  await page.getByTestId('system-eq-1').fill('0.5*y')
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await page.getByTestId('close-system-settings').click()

  await harness.createEquilibrium()
  await harness.selectTreeNode('Fixed_point_1')
  await page.getByTestId('action-equilibrium-solver-toggle').click()
  await page.getByTestId('equilibrium-solve-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-equilibrium-continuation-toggle').click()
  await page.getByTestId('equilibrium-branch-name').fill('map_pitchfork_points')
  await page.getByTestId('equilibrium-branch-parameter').selectOption('mu')
  await page.getByTestId('equilibrium-branch-step-size').fill('0.025')
  await page.getByTestId('equilibrium-branch-max-steps').fill('18')
  await page.getByTestId('equilibrium-branch-min-step').fill('1e-7')
  await page.getByTestId('equilibrium-branch-max-step').fill('0.05')
  await page.getByTestId('equilibrium-branch-corrector-steps').fill('12')
  await page.getByTestId('equilibrium-branch-corrector-tolerance').fill('1e-10')
  await page.getByTestId('equilibrium-branch-step-tolerance').fill('1e-10')
  await page.getByTestId('equilibrium-branch-submit').click()

  await selectMapBranchPoint(page)
  await page.getByTestId('compute-normal-form').click()
  const readout = page.getByTestId('normal-form-readout')
  await expect(readout).toContainText('Generic +1 branch point', { timeout: 30_000 })
  await expect(readout).toContainText('Pitchfork')
  await expect(readout).toContainText('-7.404')
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()

  await page.reload()
  if (!(await page.getByTestId('workspace').isVisible())) {
    await harness.openSystem('Map_Normal_Form_E2E')
  }
  await selectMapBranchPoint(page)
  await expect(page.getByTestId('normal-form-readout')).toContainText('-7.404')
})
