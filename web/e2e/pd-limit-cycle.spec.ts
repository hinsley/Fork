import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('branch to a period-doubled limit cycle', async ({ page }) => {
  test.setTimeout(60_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true, fixture: 'pd' })

  await harness.openSystem('Period_Doubling_Fixture')
  await harness.selectTreeNode('Branch: lc_pd_mu')

  await page.getByTestId('branch-points-toggle').click()
  await page.getByTestId('branch-bifurcation-1').click()

  await page.getByTestId('limit-cycle-from-pd-toggle').click()
  await page.getByTestId('limit-cycle-from-pd-name').fill('lc_pd_branch_obj')
  await page.getByTestId('limit-cycle-from-pd-branch-name').fill('lc_pd_branch')
  await page.getByTestId('limit-cycle-from-pd-amplitude').fill('0.01')
  await page.getByTestId('limit-cycle-from-pd-ncol').fill('4')
  await page.getByTestId('limit-cycle-from-pd-step-size').fill('0.01')
  await page.getByTestId('limit-cycle-from-pd-max-steps').fill('20')
  await page.getByTestId('limit-cycle-from-pd-min-step-size').fill('1e-5')
  await page.getByTestId('limit-cycle-from-pd-max-step-size').fill('0.1')
  await page.getByTestId('limit-cycle-from-pd-corrector-steps').fill('10')
  await page.getByTestId('limit-cycle-from-pd-corrector-tolerance').fill('1e-6')
  await page.getByTestId('limit-cycle-from-pd-step-tolerance').fill('1e-6')
  await page.getByTestId('limit-cycle-from-pd-submit').click()

  const branchLabel = 'Branch: lc_pd_branch'
  await expect(page.getByRole('button', { name: new RegExp(branchLabel, 'i') })).toBeVisible()
  await harness.selectTreeNode(branchLabel)
  await expect(page.getByText(/limit cycle · (?:[2-9]|\d{2,}) points/i)).toBeVisible()
})
