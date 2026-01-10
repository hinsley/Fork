import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('system to viewport smoke', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('Smoke System')
  await harness.createScene()

  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await harness.runOrbit()

  const inspectorName = harness.inspectorName()
  await expect(inspectorName).toHaveValue(/Orbit_1/i)

  const viewport = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect(viewport).toHaveAttribute('data-trace-count', /[1-9]/)

  await harness.createEquilibrium()
  await harness.selectTreeNode('Equilibrium_1')
  await expect(inspectorName).toHaveValue(/Equilibrium_1/i)
  await harness.solveEquilibrium()
  await expect(page.getByText(/^Solved$/)).toBeVisible()

  await page.getByTestId('open-system-settings').click()
  const systemNameInput = harness.systemNameInput()
  await expect(systemNameInput).toHaveValue(/Smoke System/i)
  await page.getByTestId('close-system-settings').click()

  await page.getByTestId('open-systems').click()
  await page.getByRole('button', { name: 'Smoke System', exact: true }).click()
  await page.getByTestId('open-system-settings').click()
  await expect(systemNameInput).toHaveValue(/Smoke System/i)
  await page.getByTestId('close-system-settings').click()
})
