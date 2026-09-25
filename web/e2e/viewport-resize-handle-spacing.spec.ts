import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

async function readStackGeometry(page: Page) {
  return page.getByTestId('viewport-workspace').evaluate((workspace) => {
    const stack = workspace.querySelector('.viewport-stack') as HTMLElement
    const stackRect = stack.getBoundingClientRect()
    const tiles = Array.from(stack.querySelectorAll('[data-testid^="viewport-tile-"]')).map(
      (tile) => {
        const rect = tile.getBoundingClientRect()
        const body = tile.querySelector('.viewport-tile__body') as HTMLElement | null
        const plot = tile.querySelector('.plotly-viewport') as HTMLElement | null
        return {
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          bodyBottom: body?.getBoundingClientRect().bottom ?? null,
          plotBottom: plot?.getBoundingClientRect().bottom ?? null,
        }
      }
    )
    const handles = Array.from(stack.querySelectorAll('.viewport-resize-handle')).map(
      (handle) => {
        const rect = handle.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom, height: rect.height }
      }
    )
    return { stackTop: stackRect.top, stackBottom: stackRect.bottom, tiles, handles }
  })
}

test('viewports fill the column and share borders with their resize handles', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('Viewport_Handle_Spacing')
  await harness.createScene()

  const single = await readStackGeometry(page)
  expect(single.tiles).toHaveLength(1)
  expect(single.handles).toHaveLength(0)
  // One viewport fills the whole column: no blank area under the plot.
  expect(Math.abs(single.tiles[0].bottom - single.stackBottom)).toBeLessThanOrEqual(1)

  await page.getByTestId('viewport-add').click()
  await page.getByTestId('viewport-create-analysis').click()
  await page.getByTestId('viewport-add').click()
  await page.getByTestId('viewport-create-bifurcation').click()

  const tiles = page.locator('[data-testid^="viewport-tile-"]')
  await expect(tiles).toHaveCount(3)

  const geometry = await readStackGeometry(page)
  expect(geometry.handles).toHaveLength(2)
  // Tiles are stacked edge to edge, split the column evenly, and end at its bottom.
  expect(Math.abs(geometry.tiles[0].top - geometry.stackTop)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.tiles[2].bottom - geometry.stackBottom)).toBeLessThanOrEqual(1)
  for (let index = 0; index < 2; index += 1) {
    expect(Math.abs(geometry.tiles[index].bottom - geometry.tiles[index + 1].top)).toBeLessThanOrEqual(1)
    const handle = geometry.handles[index]
    const border = geometry.tiles[index].bottom
    expect(handle.height).toBeGreaterThan(0)
    expect(handle.top).toBeLessThanOrEqual(border)
    expect(handle.bottom).toBeGreaterThanOrEqual(border)
  }
  const heights = geometry.tiles.map((tile) => tile.height)
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2)
  for (const tile of geometry.tiles) {
    if (tile.plotBottom === null || tile.bodyBottom === null) continue
    expect(Math.abs(tile.plotBottom - tile.bodyBottom)).toBeLessThanOrEqual(1)
  }

  // Dragging the first border grows the first viewport and shrinks only its neighbour.
  const firstHandle = page.locator('.viewport-resize-handle').first()
  const box = await firstHandle.boundingBox()
  if (!box) throw new Error('Resize handle has no bounding box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 4 })
  await page.mouse.up()

  await expect
    .poll(async () => {
      const after = await readStackGeometry(page)
      return Math.round(after.tiles[0].height - geometry.tiles[0].height)
    })
    .toBeGreaterThan(30)
  const resized = await readStackGeometry(page)
  expect(Math.abs(resized.tiles[2].height - geometry.tiles[2].height)).toBeLessThanOrEqual(2)
  expect(Math.abs(resized.tiles[2].bottom - resized.stackBottom)).toBeLessThanOrEqual(1)

  // Collapsing a viewport hands its space back to the others.
  const secondToggle = page.locator('[data-testid^="viewport-toggle-"]').nth(1)
  await secondToggle.click()
  const collapsed = await readStackGeometry(page)
  expect(collapsed.tiles[1].height).toBeLessThan(40)
  expect(Math.abs(collapsed.tiles[2].bottom - collapsed.stackBottom)).toBeLessThanOrEqual(1)
  expect(collapsed.handles).toHaveLength(0)
})
