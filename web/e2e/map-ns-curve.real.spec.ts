import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('continues a real map Neimark-Sacker curve in two parameters', async ({ page }) => {
  test.setTimeout(120_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('Map_NS_Curve_E2E')

  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-type-map').click()
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-add-parameter').click()

  await page.getByTestId('system-param-0').fill('p1')
  await page.getByTestId('system-param-value-0').fill('-0.4')
  await page.getByTestId('system-param-1').fill('p2')
  await page.getByTestId('system-param-value-1').fill('0.2')

  await page
    .getByTestId('system-eq-0')
    .fill('(1+p1+p2)*(0.5*x-0.8660254037844386*y)')
  await page
    .getByTestId('system-eq-1')
    .fill('(1+p1+p2)*(0.8660254037844386*x+0.5*y)')

  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await expect(page.locator('[data-testid^="system-eq-error-"]')).toHaveCount(0)
  await page.getByTestId('close-system-settings').click()
  await expect(page.getByTestId('workspace')).toBeVisible()

  await harness.createEquilibrium()
  await harness.selectTreeNode('Fixed_point_1')
  await page.getByTestId('action-equilibrium-solver-toggle').click()
  await page.getByTestId('equilibrium-solve-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-equilibrium-continuation-toggle').click()
  await page.getByTestId('equilibrium-branch-name').fill('fixed_points_ns')
  await page.getByTestId('equilibrium-branch-parameter').selectOption('p1')
  await page.getByTestId('equilibrium-branch-step-size').fill('0.05')
  await page.getByTestId('equilibrium-branch-max-steps').fill('8')
  await page.getByTestId('equilibrium-branch-min-step').fill('1e-6')
  await page.getByTestId('equilibrium-branch-max-step').fill('0.08')
  await page.getByTestId('equilibrium-branch-corrector-steps').fill('8')
  await page.getByTestId('equilibrium-branch-corrector-tolerance').fill('1e-10')
  await page.getByTestId('equilibrium-branch-step-tolerance').fill('1e-10')
  await page.getByTestId('equilibrium-branch-submit').click()

  const fixedPointBranchLabel = 'Branch: fixed_points_ns'
  await expect(
    page.getByRole('button', { name: new RegExp(fixedPointBranchLabel, 'i') })
  ).toBeVisible({ timeout: 20_000 })
  await harness.selectTreeNode(fixedPointBranchLabel)
  await harness.openDisclosure('branch-points-toggle')

  const nsPoint = page
    .locator('[data-testid^="branch-bifurcation-"]')
    .filter({ hasText: /Neimark[- ]Sacker/i })
    .first()
  await expect(nsPoint).toBeVisible({ timeout: 20_000 })
  await nsPoint.click()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-codim1-curve-toggle').click()

  await page.getByTestId('ns-curve-name').fill('map_ns_curve')
  await page.getByTestId('ns-curve-param2').selectOption('p2')
  await page.getByTestId('ns-curve-step-size').fill('0.02')
  await page.getByTestId('ns-curve-max-steps').fill('8')
  await page.getByTestId('ns-curve-min-step-size').fill('1e-7')
  await page.getByTestId('ns-curve-max-step-size').fill('0.04')
  await page.getByTestId('ns-curve-corrector-steps').fill('10')
  await page.getByTestId('ns-curve-corrector-tolerance').fill('1e-10')
  await page.getByTestId('ns-curve-step-tolerance').fill('1e-10')
  await page.getByTestId('ns-curve-submit').click()

  const nsCurveLabel = 'Branch: map_ns_curve'
  await expect(page.getByRole('button', { name: new RegExp(nsCurveLabel, 'i') })).toBeVisible({
    timeout: 30_000,
  })
  await harness.selectTreeNode(nsCurveLabel)
  await expect(page.getByText(/neimark-sacker curve · (?:[2-9]|\d{2,}) points/i)).toBeVisible()
})
