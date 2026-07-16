import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('logistic map continuation reports local map bifurcations only', async ({ page }) => {
  test.setTimeout(120_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('LogisticMap')

  await harness.createEquilibrium()
  await harness.selectTreeNode('Fixed_point_1')
  await page.getByTestId('action-equilibrium-solver-toggle').click()
  await page.getByTestId('equilibrium-solve-guess-0').fill('0.5')
  await page.getByTestId('equilibrium-solve-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await expect(page.getByText(/^Solved$/)).toBeVisible()

  await page.getByTestId('action-equilibrium-continuation-toggle').click()
  await page.getByTestId('equilibrium-branch-name').fill('period_1_fixed_points')
  await page.getByTestId('equilibrium-branch-parameter').selectOption('r')
  await page.getByTestId('equilibrium-branch-direction').selectOption('backward')
  await page.getByTestId('equilibrium-branch-step-size').fill('0.1')
  await page.getByTestId('equilibrium-branch-max-steps').fill('30')
  await page.getByTestId('equilibrium-branch-min-step').fill('1e-6')
  await page.getByTestId('equilibrium-branch-max-step').fill('0.2')
  await page.getByTestId('equilibrium-branch-corrector-steps').fill('5')
  await page.getByTestId('equilibrium-branch-corrector-tolerance').fill('1e-8')
  await page.getByTestId('equilibrium-branch-step-tolerance').fill('1e-8')
  await page.getByTestId('equilibrium-branch-submit').click()

  const branchLabel = 'Branch: period_1_fixed_points'
  await expect(page.getByRole('button', { name: new RegExp(branchLabel, 'i') })).toBeVisible({
    timeout: 30_000,
  })
  await harness.selectTreeNode(branchLabel)
  await harness.openDisclosure('branch-points-toggle')

  const bifurcations = page.locator('[data-testid^="branch-bifurcation-"]')
  await expect(bifurcations.filter({ hasText: /Period Doubling/i })).toHaveCount(1)
  await expect(bifurcations.filter({ hasText: /Homoclinic|NCH/i })).toHaveCount(0)
})
