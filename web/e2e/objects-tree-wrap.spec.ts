import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('objects tree truncates long names on a single line without horizontal overflow', async ({ page }) => {
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

  // Single-line row: the name truncates with an ellipsis instead of wrapping.
  const rowMetrics = await longLabel.evaluate((label) => {
    const row = label.closest('.tree-node__row-motion')
    const eye = row?.querySelector('[data-testid^="node-visibility-"]')
    if (!(row instanceof HTMLElement) || !(eye instanceof HTMLElement)) {
      throw new Error('Row or visibility toggle not found')
    }
    const labelRect = label.getBoundingClientRect()
    const eyeRect = eye.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    return {
      rowHeight: rowRect.height,
      labelTruncated: label.scrollWidth > label.clientWidth,
      textOverflow: getComputedStyle(label).textOverflow,
      gapToEye: eyeRect.left - labelRect.right,
      eyeInsideRow: eyeRect.right <= rowRect.right + 0.5,
    }
  })

  expect(rowMetrics.rowHeight).toBeLessThanOrEqual(28)
  expect(rowMetrics.labelTruncated).toBe(true)
  expect(rowMetrics.textOverflow).toBe('ellipsis')
  expect(rowMetrics.gapToEye).toBeGreaterThanOrEqual(0)
  expect(rowMetrics.eyeInsideRow).toBe(true)
})
