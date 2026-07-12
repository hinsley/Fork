import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('selection rename header only appears at the top inspector level', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })
  await harness.openSystem('Lorenz')
  await harness.createOrbit()

  await expect(page.getByTestId('inspector-name')).toBeVisible()
  await page.getByTestId('action-orbit-run-toggle').click()
  await expect(page.getByTestId('inspector-workflow-back')).toBeVisible()
  await expect(page.getByTestId('inspector-name')).toHaveCount(0)

  await page.getByTestId('inspector-workflow-back').click()
  await expect(page.getByTestId('inspector-name')).toBeVisible()
})
