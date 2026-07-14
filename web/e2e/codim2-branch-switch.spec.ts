import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('switches a generalized-Hopf point to an LPC curve', async ({ page }) => {
  test.setTimeout(180_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('Codim2_Switch_E2E')

  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-param-0').fill('mu')
  await page.getByTestId('system-param-value-0').fill('-0.5')
  await page.getByTestId('system-param-1').fill('beta')
  await page.getByTestId('system-param-value-1').fill('-0.5')
  await page.getByTestId('system-eq-0').fill(
    'mu*x-y+beta*x*(x^2+y^2)+x*(x^2+y^2)^2'
  )
  await page.getByTestId('system-eq-1').fill(
    'x+mu*y+beta*y*(x^2+y^2)+y*(x^2+y^2)^2'
  )
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await page.getByTestId('close-system-settings').click()

  await harness.createEquilibrium()
  await harness.selectTreeNode('Equilibrium_1')
  await page.getByTestId('action-equilibrium-solver-toggle').click()
  await page.getByTestId('equilibrium-solve-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-equilibrium-continuation-toggle').click()
  await page.getByTestId('equilibrium-branch-name').fill('eq_codim2')
  await page.getByTestId('equilibrium-branch-parameter').selectOption('mu')
  await page.getByTestId('equilibrium-branch-step-size').fill('0.05')
  await page.getByTestId('equilibrium-branch-max-steps').fill('30')
  await page.getByTestId('equilibrium-branch-submit').click()

  await harness.selectTreeNode('Branch: eq_codim2')
  await harness.openDisclosure('branch-points-toggle')
  await page.locator('[data-testid^="branch-bifurcation-"]').first().click()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-codim1-curve-toggle').click()
  await page.getByTestId('hopf-curve-name').fill('hopf_codim2')
  await page.getByTestId('hopf-curve-param2').selectOption('beta')
  await page.getByTestId('hopf-curve-step-size').fill('0.02')
  await page.getByTestId('hopf-curve-max-steps').fill('80')
  await page.getByTestId('hopf-curve-min-step-size').fill('1e-6')
  await page.getByTestId('hopf-curve-max-step-size').fill('0.1')
  await page.getByTestId('hopf-curve-corrector-steps').fill('8')
  await page.getByTestId('hopf-curve-corrector-tolerance').fill('1e-8')
  await page.getByTestId('hopf-curve-step-tolerance').fill('1e-8')
  await page.getByTestId('hopf-curve-submit').click()

  await harness.selectTreeNode('Branch: hopf_codim2')
  await harness.openDisclosure('branch-points-toggle')
  const generalizedHopf = page
    .locator('[data-testid^="branch-bifurcation-"]')
    .filter({ hasText: /Generalized Hopf/i })
    .first()
  await expect(generalizedHopf).toBeVisible({ timeout: 30_000 })
  await generalizedHopf.click()
  await page.getByTestId('branch-point-details-toggle').click()
  await expect(page.getByTestId('codim2-switch-lpc')).toBeVisible()
  await page.getByTestId('codim2-switch-lpc').click()

  await expect(page.getByText(/lpc curve · (?:[2-9]|\d{2,}) points/i)).toBeVisible({
    // The real-WASM switch takes about 50 seconds in isolation and can cross
    // 60 seconds when the full Playwright suite runs five solver workers.
    timeout: 90_000,
  })
  await page.getByTestId('action-branch-summary-toggle').click()
  await expect(page.getByText('Switched from')).toBeVisible()
  await expect(page.getByText('GeneralizedHopf')).toBeVisible()
})
