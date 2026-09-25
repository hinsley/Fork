import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('reload reopens the last open system; going home forgets it', async ({ page }) => {
  const harness = createHarness(page)
  // Persistence (OPFS, else IndexedDB) is only used outside deterministic mode.
  await harness.goto({ deterministic: false, mock: true })
  await harness.createSystem('Reopen_After_Reload')
  await expect(page.getByTestId('workspace')).toBeVisible()

  await page.reload()
  await expect(page.getByTestId('workspace')).toBeVisible()
  await expect(page.getByTestId('toolbar')).toContainText('Reopen_After_Reload')

  await page.getByTestId('go-home').click()
  await expect(page.getByTestId('home')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('system-library')).toBeVisible()
  // Negative check: give a (wrong) restore time to happen.
  await page.waitForTimeout(500)
  await expect(page.getByTestId('workspace')).toHaveCount(0)
})

test('deterministic mode always starts on home', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })
  await harness.createSystem('Deterministic_Reload')
  await page.reload()
  await expect(page.getByTestId('system-library')).toBeVisible()
  // Negative check: give a (wrong) restore time to happen.
  await page.waitForTimeout(500)
  await expect(page.getByTestId('workspace')).toHaveCount(0)
})
