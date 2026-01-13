import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('splitter drag does not interact with plotly or select text', async ({ page }) => {
  test.setTimeout(60_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('Splitter Drag Test')
  await harness.createScene()

  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await harness.runOrbit()

  const viewport = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect(viewport).toHaveAttribute('data-trace-count', /[1-9]/)

  await page.evaluate(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]')
    ;(window as { __plotlyDragMoves?: number }).__plotlyDragMoves = 0
    if (node) {
      const handler = (event: Event) => {
        const buttons = (event as MouseEvent).buttons
        if (buttons === 1) {
          const store = window as { __plotlyDragMoves?: number }
          store.__plotlyDragMoves = (store.__plotlyDragMoves ?? 0) + 1
        }
      }
      node.addEventListener('pointermove', handler)
      node.addEventListener('mousemove', handler)
    }
  })

  const splitter = page.getByTestId('splitter-left')
  const workspace = page.getByTestId('workspace')
  const splitterBox = await splitter.boundingBox()
  const viewportBox = await viewport.boundingBox()
  if (!splitterBox || !viewportBox) {
    throw new Error('Missing splitter or viewport bounds.')
  }

  await page.mouse.move(
    splitterBox.x + splitterBox.width / 2,
    splitterBox.y + splitterBox.height / 2
  )
  await page.mouse.down()
  await expect(workspace).toHaveClass(/workspace--resizing/)

  await page.mouse.move(
    viewportBox.x + viewportBox.width / 2,
    viewportBox.y + viewportBox.height / 2
  )
  await page.mouse.move(
    viewportBox.x + viewportBox.width / 2 + 40,
    viewportBox.y + viewportBox.height / 2 + 20
  )
  await page.mouse.up()

  await expect(workspace).not.toHaveClass(/workspace--resizing/)

  const dragMoves = await page.evaluate(
    () => (window as { __plotlyDragMoves?: number }).__plotlyDragMoves ?? 0
  )
  expect(dragMoves).toBe(0)

  const selectionText = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selectionText).toBe('')
})
