import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('viewport content ends where the resize handle begins', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('Viewport_Handle_Spacing')
  await harness.createScene()

  const insertButtons = page.locator('[data-testid^="viewport-insert-"] .viewport-insert__button')
  await insertButtons.last().click()
  await page.getByTestId('viewport-create-analysis').click()
  await insertButtons.last().click()
  await page.getByTestId('viewport-create-bifurcation').click()

  const tiles = page.locator('[data-testid^="viewport-tile-"]')
  await expect(tiles).toHaveCount(3)

  for (let index = 0; index < 3; index += 1) {
    const tile = tiles.nth(index)
    await tile.scrollIntoViewIfNeeded()

    const geometry = await tile.evaluate((node) => {
      const body = node.querySelector('.viewport-tile__body') as HTMLElement | null
      const viewport = node.querySelector('.plotly-viewport') as HTMLElement | null
      const handle = node.querySelector('.viewport-resize-handle') as HTMLElement | null
      if (!body || !viewport || !handle) return null

      const bodyRect = body.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      const handleRect = handle.getBoundingClientRect()
      const handleStyle = getComputedStyle(handle)

      return {
        bodyBottom: bodyRect.bottom,
        viewportBottom: viewportRect.bottom,
        handleTop: handleRect.top,
        handleHeight: handleRect.height,
        handlePosition: handleStyle.position,
      }
    })

    expect(geometry).not.toBeNull()
    expect(Math.abs((geometry?.bodyBottom ?? 0) - (geometry?.handleTop ?? 0))).toBeLessThanOrEqual(
      1
    )
    expect(
      Math.abs((geometry?.viewportBottom ?? 0) - (geometry?.handleTop ?? 0))
    ).toBeLessThanOrEqual(1)
    expect(geometry?.handleHeight).toBeGreaterThan(0)
    expect(geometry?.handlePosition).toBe('relative')
  }
})
