import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('continues a detected cycle fold as a real LPC curve', async ({ page }) => {
  test.setTimeout(150_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('Flow_LPC_Curve_E2E')

  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-param-0').fill('mu')
  await page.getByTestId('system-param-value-0').fill('0.24')
  await page.getByTestId('system-param-1').fill('beta')
  await page.getByTestId('system-param-value-1').fill('-1')
  await page
    .getByTestId('system-eq-0')
    .fill('mu*x-y+beta*x*(x^2+y^2)+x*(x^2+y^2)^2')
  await page
    .getByTestId('system-eq-1')
    .fill('x+mu*y+beta*y*(x^2+y^2)+y*(x^2+y^2)^2')
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await page.getByTestId('close-system-settings').click()

  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await page.getByTestId('action-orbit-run-toggle').click()
  await page.getByTestId('orbit-run-duration').fill('20')
  await page.getByTestId('orbit-run-dt').fill('0.02')
  await page.getByTestId('orbit-run-ic-0').fill('0.6324555320336759')
  await page.getByTestId('orbit-run-ic-1').fill('0')
  await page.getByTestId('orbit-run-submit').click()

  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-limit-cycle-toggle').click()
  await page.getByTestId('limit-cycle-from-orbit-name').fill('lc_bautin')
  await page.getByTestId('limit-cycle-from-orbit-branch-name').fill('lc_bautin_mu')
  await page.getByTestId('limit-cycle-from-orbit-parameter').selectOption('mu')
  await page.getByTestId('limit-cycle-from-orbit-tolerance').fill('0.05')
  await page.getByTestId('limit-cycle-from-orbit-ntst').fill('8')
  await page.getByTestId('limit-cycle-from-orbit-ncol').fill('3')
  await page.getByTestId('limit-cycle-from-orbit-step-size').fill('0.005')
  await page.getByTestId('limit-cycle-from-orbit-max-steps').fill('12')
  await page.getByTestId('limit-cycle-from-orbit-min-step-size').fill('1e-6')
  await page.getByTestId('limit-cycle-from-orbit-max-step-size').fill('0.01')
  await page.getByTestId('limit-cycle-from-orbit-corrector-steps').fill('12')
  await page.getByTestId('limit-cycle-from-orbit-corrector-tolerance').fill('1e-9')
  await page.getByTestId('limit-cycle-from-orbit-step-tolerance').fill('1e-10')
  await page.getByTestId('limit-cycle-from-orbit-submit').click()

  const cycleBranchLabel = 'Branch: lc_bautin_mu'
  await expect(page.getByRole('button', { name: new RegExp(cycleBranchLabel, 'i') })).toBeVisible({
    timeout: 30_000,
  })
  await harness.selectTreeNode(cycleBranchLabel)
  await harness.openDisclosure('branch-points-toggle')
  const cycleFold = page
    .locator('[data-testid^="branch-bifurcation-"]')
    .filter({ hasText: /Cycle Fold/i })
    .first()
  await expect(cycleFold).toBeVisible({ timeout: 30_000 })
  await cycleFold.click()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-limit-cycle-codim1-curve-toggle').click()

  await page.getByTestId('limit-cycle-codim1-curve-name').fill('lpc_bautin')
  await page.getByTestId('limit-cycle-codim1-curve-param2').selectOption('beta')
  await page.getByTestId('limit-cycle-codim1-curve-step-size').fill('0.01')
  await page.getByTestId('limit-cycle-codim1-curve-max-steps').fill('8')
  await page.getByTestId('limit-cycle-codim1-curve-min-step-size').fill('1e-6')
  await page.getByTestId('limit-cycle-codim1-curve-max-step-size').fill('0.04')
  await page.getByTestId('limit-cycle-codim1-curve-corrector-steps').fill('12')
  await page.getByTestId('limit-cycle-codim1-curve-corrector-tolerance').fill('1e-9')
  await page.getByTestId('limit-cycle-codim1-curve-step-tolerance').fill('1e-10')
  await page.getByTestId('limit-cycle-codim1-curve-submit').click()

  const lpcBranchLabel = 'Branch: lpc_bautin'
  await expect(page.getByRole('button', { name: new RegExp(lpcBranchLabel, 'i') })).toBeVisible({
    timeout: 30_000,
  })
  await harness.selectTreeNode(lpcBranchLabel)
  await expect(page.getByText(/lpc curve · (?:[2-9]|\d{2,}) points/i)).toBeVisible()
})
