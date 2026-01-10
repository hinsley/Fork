import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('system settings show unapplied change controls', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('Unapplied System')
  await page.getByTestId('inspector-tab-system').click()

  const nameInput = harness.systemNameInput()
  await expect(nameInput).toHaveValue(/Unapplied System/i)

  await expect(page.getByTestId('system-unapplied-indicator')).toHaveCount(0)
  await expect(page.getByTestId('system-apply')).toHaveCount(0)
  await expect(page.getByTestId('system-discard')).toHaveCount(0)

  await nameInput.fill('Unapplied System Edited')

  await expect(page.getByTestId('system-unapplied-indicator')).toBeVisible()
  await expect(page.getByTestId('system-apply')).toBeVisible()
  await expect(page.getByTestId('system-discard')).toBeVisible()

  await page.getByTestId('system-discard').click()

  await expect(nameInput).toHaveValue(/Unapplied System/i)
  await expect(page.getByTestId('system-unapplied-indicator')).toHaveCount(0)
  await expect(page.getByTestId('system-apply')).toHaveCount(0)
  await expect(page.getByTestId('system-discard')).toHaveCount(0)
})
