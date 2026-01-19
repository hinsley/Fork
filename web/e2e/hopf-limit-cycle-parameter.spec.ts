import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('continue limit cycle from Hopf along a selected parameter', async ({ page }) => {
  test.setTimeout(150_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })

  await harness.createSystem('Hopf_LC_Param_E2E')

  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-add-parameter').click()

  await page.getByTestId('system-param-0').fill('mu')
  await page.getByTestId('system-param-value-0').fill('-0.1')
  await page.getByTestId('system-param-1').fill('beta')
  await page.getByTestId('system-param-value-1').fill('0.0')

  await page.getByTestId('system-eq-0').fill('(mu + beta) * x - y - x * (x^2 + y^2)')
  await page.getByTestId('system-eq-1').fill('x + (mu + beta) * y - y * (x^2 + y^2)')

  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await expect(page.locator('[data-testid^="system-eq-error-"]')).toHaveCount(0)

  await page.getByTestId('close-system-settings').click()

  await harness.createEquilibrium()
  await expect(
    page.locator('[data-testid^="object-tree-node-"]').filter({ hasText: /Equilibrium_1/i })
  ).toBeVisible()
  await harness.selectTreeNode('Equilibrium_1')

  await page.getByTestId('equilibrium-solver-toggle').click()
  await page.getByTestId('equilibrium-solve-submit').click()
  await expect(page.getByText(/^Solved$/)).toBeVisible()

  await page.getByTestId('equilibrium-continuation-toggle').click()
  await page.getByTestId('equilibrium-branch-name').fill('eq_hopf_mu')
  await page.getByTestId('equilibrium-branch-parameter').selectOption('mu')
  await page.getByTestId('equilibrium-branch-step-size').fill('0.02')
  await page.getByTestId('equilibrium-branch-max-steps').fill('40')
  await page.getByTestId('equilibrium-branch-min-step').fill('1e-6')
  await page.getByTestId('equilibrium-branch-max-step').fill('0.1')
  await page.getByTestId('equilibrium-branch-corrector-steps').fill('5')
  await page.getByTestId('equilibrium-branch-corrector-tolerance').fill('1e-6')
  await page.getByTestId('equilibrium-branch-step-tolerance').fill('1e-6')
  await page.getByTestId('equilibrium-branch-submit').click()

  const eqBranchLabel = 'Branch: eq_hopf_mu'
  await expect(page.getByRole('button', { name: new RegExp(eqBranchLabel, 'i') })).toBeVisible({
    timeout: 20_000,
  })
  await harness.selectTreeNode(eqBranchLabel)

  await harness.openDisclosure('branch-points-toggle')
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

  await page.getByTestId('limit-cycle-from-hopf-toggle').click()
  await page.getByTestId('limit-cycle-from-hopf-name').fill('lc_hopf_beta')
  await page.getByTestId('limit-cycle-from-hopf-branch-name').fill('lc_hopf_beta_branch')
  await page.getByTestId('limit-cycle-from-hopf-parameter').selectOption('beta')
  await page.getByTestId('limit-cycle-from-hopf-amplitude').fill('0.1')
  await page.getByTestId('limit-cycle-from-hopf-ntst').fill('10')
  await page.getByTestId('limit-cycle-from-hopf-ncol').fill('4')
  await page.getByTestId('limit-cycle-from-hopf-step-size').fill('0.02')
  await page.getByTestId('limit-cycle-from-hopf-max-steps').fill('20')
  await page.getByTestId('limit-cycle-from-hopf-min-step-size').fill('1e-6')
  await page.getByTestId('limit-cycle-from-hopf-max-step-size').fill('0.1')
  await page.getByTestId('limit-cycle-from-hopf-corrector-steps').fill('8')
  await page.getByTestId('limit-cycle-from-hopf-corrector-tolerance').fill('1e-6')
  await page.getByTestId('limit-cycle-from-hopf-step-tolerance').fill('1e-6')
  await page.getByTestId('limit-cycle-from-hopf-submit').click()

  const lcBranchLabel = 'Branch: lc_hopf_beta_branch'
  await expect(page.getByRole('button', { name: new RegExp(lcBranchLabel, 'i') })).toBeVisible({
    timeout: 30_000,
  })
  await harness.selectTreeNode(lcBranchLabel)
  await expect(page.getByText(/limit cycle · (?:[2-9]|\d{2,}) points/i)).toBeVisible()
})
