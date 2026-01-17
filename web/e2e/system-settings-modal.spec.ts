import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('system settings open in a modal and inspector has no tabs', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('Modal_System')

  await expect(page.locator('[role="tablist"]')).toHaveCount(0)

  await page.getByTestId('open-system-settings').click()
  const settingsDialog = page.getByTestId('system-settings-dialog')
  await expect(settingsDialog).toBeVisible()
  await expect(page.getByTestId('system-name')).toHaveValue(/Modal_System/i)

  await page.getByTestId('close-system-settings').click()
  await expect(settingsDialog).toHaveCount(0)
})
