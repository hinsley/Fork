import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('objects tree wraps long names without horizontal overflow', async ({ page }) => {
  test.setTimeout(60_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })
  await harness.createSystem('Objects_Wrap_Test')
  await harness.createOrbit()

  const orbitLabel = page
    .locator('[data-testid^="object-tree-node-"]')
    .filter({ hasText: /Orbit_/i })
    .first()
  await orbitLabel.click({ button: 'right' })
  await page.getByTestId('object-context-menu').waitFor()
  await page.getByTestId('object-context-rename').click()

  const input = page.locator('[data-testid^="node-rename-input-"]').first()
  const longName = `Orbit_${'A'.repeat(64)}`
  await input.fill(longName)
  await input.press('Enter')

  await expect(
    page
      .locator('[data-testid^="object-tree-node-"]')
      .filter({ hasText: new RegExp(longName, 'i') })
      .first()
  ).toBeVisible()

  const longLabel = page
    .locator('[data-testid^="object-tree-node-"]')
    .filter({ hasText: new RegExp(longName, 'i') })
    .first()
  const longRow = longLabel.locator('..')
  const { clientWidth, scrollWidth } = await longRow.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }))

  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
})
