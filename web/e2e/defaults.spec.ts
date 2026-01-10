import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('defaults to light theme with systems dialog closed', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('open-systems-empty')).toBeVisible()
})
