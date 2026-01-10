import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('rossler hopf curve continuation', async ({ page }) => {
  test.setTimeout(120_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('Rossler')

  await page.getByTestId('inspector-tab-system').click()
  await page.getByTestId('system-param-value-1').fill('0.4')
  await page.getByTestId('system-param-value-2').fill('1.4')
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await expect(page.locator('[data-testid^="system-eq-error-"]')).toHaveCount(0)

  await page.getByTestId('inspector-tab-selection').click()

  await harness.createEquilibrium()
  await expect(
    page.locator('[data-testid^="object-tree-node-"]').filter({ hasText: /Equilibrium_1/i })
  ).toBeVisible()
  await harness.selectTreeNode('Equilibrium_1')

  await page.getByTestId('equilibrium-solver-toggle').click()
  await page.getByTestId('equilibrium-solve-guess-0').fill('0.1')
  await page.getByTestId('equilibrium-solve-guess-1').fill('-0.3')
  await page.getByTestId('equilibrium-solve-guess-2').fill('0.3')
  await page.getByTestId('equilibrium-solve-steps').fill('50')
  await page.getByTestId('equilibrium-solve-damping').fill('1')
  await page.getByTestId('equilibrium-solve-submit').click()
  await expect(page.getByText(/^Solved$/)).toBeVisible()

  await page.getByTestId('equilibrium-continuation-toggle').click()
  await page.getByTestId('equilibrium-branch-name').fill('eq_rossler_c')
  await page.getByTestId('equilibrium-branch-parameter').selectOption('c')
  await page.getByTestId('equilibrium-branch-direction').selectOption('backward')
  await page.getByTestId('equilibrium-branch-step-size').fill('0.02')
  await page.getByTestId('equilibrium-branch-max-steps').fill('40')
  await page.getByTestId('equilibrium-branch-min-step').fill('1e-6')
  await page.getByTestId('equilibrium-branch-max-step').fill('0.1')
  await page.getByTestId('equilibrium-branch-corrector-steps').fill('5')
  await page.getByTestId('equilibrium-branch-corrector-tolerance').fill('1e-8')
  await page.getByTestId('equilibrium-branch-step-tolerance').fill('1e-8')
  await page.getByTestId('equilibrium-branch-submit').click()

  const eqBranchLabel = 'Branch: eq_rossler_c'
  await expect(page.getByRole('button', { name: new RegExp(eqBranchLabel, 'i') })).toBeVisible({
    timeout: 20_000,
  })
  await harness.selectTreeNode(eqBranchLabel)

  await page.getByTestId('branch-points-toggle').click()
  const bifurcations = page.locator('[data-testid^="branch-bifurcation-"]')
  await expect(bifurcations.first()).toBeVisible({ timeout: 20_000 })
  const bifCount = await bifurcations.count()
  let hopfFound = false
  for (let i = 0; i < bifCount; i += 1) {
    await bifurcations.nth(i).click()
    if (await page.getByText('Stability: Hopf').isVisible()) {
      hopfFound = true
      break
    }
  }
  expect(hopfFound).toBeTruthy()

  await page.getByTestId('codim1-curve-toggle').click()
  await page.getByTestId('hopf-curve-name').fill('hopf_curve_rossler')
  await page.getByTestId('hopf-curve-param2').selectOption('b')
  await page.getByTestId('hopf-curve-step-size').fill('0.02')
  await page.getByTestId('hopf-curve-max-steps').fill('20')
  await page.getByTestId('hopf-curve-min-step-size').fill('1e-6')
  await page.getByTestId('hopf-curve-max-step-size').fill('0.1')
  await page.getByTestId('hopf-curve-corrector-steps').fill('5')
  await page.getByTestId('hopf-curve-corrector-tolerance').fill('1e-8')
  await page.getByTestId('hopf-curve-step-tolerance').fill('1e-8')
  await page.getByTestId('hopf-curve-submit').click()

  const hopfCurveLabel = 'Branch: hopf_curve_rossler'
  await expect(page.getByRole('button', { name: new RegExp(hopfCurveLabel, 'i') })).toBeVisible({
    timeout: 20_000,
  })
  await harness.selectTreeNode(hopfCurveLabel)
  await expect(page.getByText(/hopf curve · (?:[2-9]|\d{2,}) points/i)).toBeVisible()
})
