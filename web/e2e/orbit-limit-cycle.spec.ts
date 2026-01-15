import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('continue limit cycle from orbit data', async ({ page }) => {
  test.setTimeout(150_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })

  await harness.createSystem('Orbit LC E2E')

  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-add-parameter').click()

  await page.getByTestId('system-param-0').fill('mu')
  await page.getByTestId('system-param-value-0').fill('0.5')

  await page.getByTestId('system-eq-0').fill('mu * x - y - x * (x^2 + y^2)')
  await page.getByTestId('system-eq-1').fill('x + mu * y - y * (x^2 + y^2)')

  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await expect(page.locator('[data-testid^="system-eq-error-"]')).toHaveCount(0)

  await page.getByTestId('close-system-settings').click()

  await harness.createOrbit()
  await expect(
    page.locator('[data-testid^="object-tree-node-"]').filter({ hasText: /Orbit_1/i })
  ).toBeVisible()
  await harness.selectTreeNode('Orbit_1')

  await page.getByTestId('orbit-run-toggle').click()
  await page.getByTestId('orbit-run-duration').fill('60')
  await page.getByTestId('orbit-run-dt').fill('0.02')
  await page.getByTestId('orbit-run-ic-0').fill('1')
  await page.getByTestId('orbit-run-ic-1').fill('0')
  await page.getByTestId('orbit-run-submit').click()

  await expect(page.getByText('No orbit samples stored yet.')).toHaveCount(0)

  await page.getByTestId('limit-cycle-toggle').click()
  await page.getByTestId('limit-cycle-from-orbit-name').fill('lc_orbit_mu')
  await page.getByTestId('limit-cycle-from-orbit-branch-name').fill('lc_orbit_branch')
  await page.getByTestId('limit-cycle-from-orbit-parameter').selectOption('mu')
  await page.getByTestId('limit-cycle-from-orbit-tolerance').fill('0.1')
  await page.getByTestId('limit-cycle-from-orbit-ntst').fill('20')
  await page.getByTestId('limit-cycle-from-orbit-ncol').fill('4')
  await page.getByTestId('limit-cycle-from-orbit-step-size').fill('0.01')
  await page.getByTestId('limit-cycle-from-orbit-max-steps').fill('20')
  await page.getByTestId('limit-cycle-from-orbit-min-step-size').fill('1e-5')
  await page.getByTestId('limit-cycle-from-orbit-max-step-size').fill('0.1')
  await page.getByTestId('limit-cycle-from-orbit-corrector-steps').fill('10')
  await page.getByTestId('limit-cycle-from-orbit-corrector-tolerance').fill('1e-6')
  await page.getByTestId('limit-cycle-from-orbit-step-tolerance').fill('1e-6')
  await page.getByTestId('limit-cycle-from-orbit-submit').click()

  const lcBranchLabel = 'Branch: lc_orbit_branch'
  await expect(page.getByRole('button', { name: new RegExp(lcBranchLabel, 'i') })).toBeVisible({
    timeout: 30_000,
  })
  await harness.selectTreeNode(lcBranchLabel)
  await expect(page.getByText(/limit cycle · (?:[2-9]|\d{2,}) points/i)).toBeVisible()
})
