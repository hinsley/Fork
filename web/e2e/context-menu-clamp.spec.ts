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

test('object and viewport menus remain reachable at the bottom edge', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true, fixture: 'demo' })
  await harness.openSystem('Demo_System')
  await harness.createScene()

  const cases = [
    {
      trigger: page.getByTestId('create-object-button'),
      event: 'click',
      menu: page.getByTestId('create-object-menu'),
    },
    {
      trigger: page.locator('[data-testid^="object-tree-node-"]').first(),
      event: 'contextmenu',
      menu: page.getByTestId('object-context-menu'),
    },
    {
      trigger: page.getByRole('button', { name: 'Add viewport', exact: true }),
      event: 'click',
      menu: page.getByTestId('viewport-create-menu'),
    },
    {
      trigger: page.locator('[data-testid^="viewport-header-"]').first(),
      event: 'contextmenu',
      menu: page.getByTestId('viewport-context-menu'),
    },
  ]

  for (const { trigger, event, menu } of cases) {
    await trigger.evaluate((element, eventName) => {
      element.dispatchEvent(new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        clientX: 640,
        clientY: 718,
        button: eventName === 'contextmenu' ? 2 : 0,
      }))
    }, event)
    await expect(menu).toBeVisible()
    await expect
      .poll(async () => {
        const box = await menu.boundingBox()
        return box ? box.y + box.height : Number.POSITIVE_INFINITY
      })
      .toBeLessThanOrEqual(720)
    await expect(menu.getByRole('button').last()).toBeInViewport()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }
})
