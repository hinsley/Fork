import { expect, test } from '@playwright/test'

test('system to viewport smoke', async ({ page }) => {
  await page.goto('/?mock=1')

  await page.getByTestId('system-name-input').fill('Smoke System')
  await page.getByTestId('create-system').click()

  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-orbit').click()
  await page.getByRole('button', { name: /Orbit 1/i }).click()

  const inspectorName = page.getByTestId('inspector-name')
  await expect(inspectorName).toHaveValue(/Orbit 1/i)

  const viewport = page.locator('[data-testid^=\"plotly-viewport-\"]').first()
  await expect(viewport).toHaveAttribute('data-trace-count', /[1-9]/)

  await page.getByTestId('inspector-tab-branches').click()
  const branchPanel = page.getByTestId('branch-viewer-panel')
  await expect(branchPanel).toBeVisible()
})
