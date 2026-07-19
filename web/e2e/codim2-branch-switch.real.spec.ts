import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('switches a generalized-Hopf point to an LPC curve', async ({ page }) => {
  test.setTimeout(120_000)
  const harness = createHarness(page)
  await harness.goto({
    deterministic: true,
    mock: false,
    fixture: 'codim2-generalized-hopf',
  })
  await harness.openSystem('Codim2_Switch_E2E')
  await harness.selectTreeNode('Branch: hopf_codim2_fixture')
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
