import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

const RESET_MESSAGE =
  'Are you absolutely 100% sure you want to completely reset everything in Fork? This will delete all systems and any data you have stored. Make sure to export any systems with data you want to preserve.'

test('reset fork clears stored systems after confirmation', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('ResetTestSystem')
  await expect(page.getByTestId('workspace')).toBeVisible()

  await page.getByTestId('open-settings').click()
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    expect(dialog.message()).toBe(RESET_MESSAGE)
    await dialog.accept()
  })
  await page.getByTestId('reset-fork').click()

  await page.waitForLoadState('domcontentloaded')
  const library = page.getByTestId('home').getByTestId('system-library')
  await expect(library).toBeVisible()
  await expect(
    library.getByRole('button', { name: 'ResetTestSystem', exact: true })
  ).toHaveCount(0)
})
