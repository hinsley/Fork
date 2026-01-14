import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('rossler hopf to limit cycle continuation reports missing eigenpair', async ({ page }) => {
  test.setTimeout(180_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('Rossler')

  await harness.createEquilibrium()
  await expect(
    page.locator('[data-testid^="object-tree-node-"]').filter({ hasText: /Equilibrium_1/i })
  ).toBeVisible()
  await harness.selectTreeNode('Equilibrium_1')

  await page.getByTestId('equilibrium-solver-toggle').click()
  await page.getByTestId('equilibrium-solve-guess-0').fill('0')
  await page.getByTestId('equilibrium-solve-guess-1').fill('0')
  await page.getByTestId('equilibrium-solve-guess-2').fill('0')
  await page.getByTestId('equilibrium-solve-submit').click()
  await expect(page.getByText(/^Solved$/)).toBeVisible()

  await page.getByTestId('equilibrium-continuation-toggle').click()
  await page.getByTestId('equilibrium-branch-name').fill('eq_rossler_a')
  await page.getByTestId('equilibrium-branch-parameter').selectOption('a')
  await page.getByTestId('equilibrium-branch-submit').click()

  const eqBranchLabel = 'Branch: eq_rossler_a'
  await expect(page.getByRole('button', { name: new RegExp(eqBranchLabel, 'i') })).toBeVisible({
    timeout: 30_000,
  })
  await harness.selectTreeNode(eqBranchLabel)

  await page.getByTestId('branch-points-toggle').click()
  await page.getByTestId('branch-point-input').fill('63')
  await page.getByTestId('branch-point-jump').click()
  await expect(page.getByText('Stability: Hopf')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('limit-cycle-from-hopf-toggle').click()
  await page.getByTestId('limit-cycle-from-hopf-name').fill('lc_rossler_hopf')
  await page.getByTestId('limit-cycle-from-hopf-branch-name').fill('lc_rossler_hopf_branch')
  await page.getByTestId('limit-cycle-from-hopf-parameter').selectOption('a')
  await page.getByTestId('limit-cycle-from-hopf-submit').click()

  await expect(page.getByRole('alert')).toContainText(
    'Failed to initialize limit cycle: Could not locate Hopf eigenpair'
  )
})
