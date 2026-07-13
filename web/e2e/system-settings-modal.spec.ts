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

test('system string import replaces the variable and parameter setup', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('String_Import_System')
  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('import-system-string').click()
  await page
    .getByTestId('system-string-input')
    .fill("u'=alpha * u\n\nalpha = 2.5e-1")
  await page.getByTestId('replace-from-system-string').click()

  await expect(page.getByTestId('system-var-0')).toHaveValue('u')
  await expect(page.getByTestId('system-var-1')).toHaveCount(0)
  await expect(page.getByTestId('system-eq-0')).toHaveValue('alpha * u')
  await expect(page.getByTestId('system-param-0')).toHaveValue('alpha')
  await expect(page.getByTestId('system-param-value-0')).toHaveValue('0.25')
  await expect(page.getByRole('status')).toContainText('Apply changes to save')

  await page.getByTestId('system-apply').click()
  await expect(page.getByRole('status')).toHaveCount(0)

  await page.getByTestId('close-system-settings').click()
  await page.getByTestId('open-system-settings').click()
  await expect(page.getByTestId('system-var-0')).toHaveValue('u')
  await expect(page.getByTestId('system-param-0')).toHaveValue('alpha')
})
