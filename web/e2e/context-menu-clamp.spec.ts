import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('context menus clamp to the viewport width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 })

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.openSystem('Lorenz')

  const button = page.getByTestId('create-object-button')
  const box = await button.boundingBox()
  if (!box) {
    throw new Error('Create object button bounds not found.')
  }
  const viewport = page.viewportSize()
  if (!viewport) {
    throw new Error('Viewport size not found.')
  }

  await button.dispatchEvent('click', {
    clientX: viewport.width - 2,
    clientY: box.y + box.height / 2,
    button: 0,
  })

  const menu = page.getByTestId('create-object-menu')
  await expect(menu).toBeVisible()
  const menuBox = await menu.boundingBox()
  if (!menuBox) {
    throw new Error('Create object menu bounds not found.')
  }

  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width)
})
