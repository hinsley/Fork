import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('plotly view state persists after drag ends outside the plot', async ({ page }) => {
  test.setTimeout(60_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.openSystem('Lorenz')
  await harness.createScene()

  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await harness.runOrbit()

  const viewport = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect(viewport).toHaveAttribute('data-trace-count', /[1-9]/)

  const readCameraKey = () =>
    page.evaluate(() => {
      const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
        | (HTMLElement & {
            layout?: { scene?: { camera?: { eye?: { x?: number; y?: number; z?: number } } } }
            _fullLayout?: {
              scene?: {
                camera?: { eye?: { x?: number; y?: number; z?: number } }
                _scene?: { camera?: { eye?: { x?: number; y?: number; z?: number } } }
              }
            }
          })
        | null
      const camera =
        node?._fullLayout?.scene?._scene?.camera ??
        node?._fullLayout?.scene?.camera ??
        node?.layout?.scene?.camera
      if (!camera?.eye) return null
      const eye =
        Array.isArray(camera.eye) && camera.eye.length >= 3
          ? { x: camera.eye[0], y: camera.eye[1], z: camera.eye[2] }
          : camera.eye
      if (eye?.x == null || eye?.y == null || eye?.z == null) return null
      return `${eye.x.toFixed(4)}|${eye.y.toFixed(4)}|${eye.z.toFixed(4)}`
    })
  const waitForFrame = () =>
    page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

  const initialCameraKey = await readCameraKey()
  if (!initialCameraKey) {
    throw new Error('Initial camera state not found.')
  }

  const box = await viewport.boundingBox()
  if (!box) {
    throw new Error('Plotly viewport bounds not found.')
  }

  const startX = box.x + box.width * 0.6
  const startY = box.y + box.height * 0.6

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 140, startY - 90, { steps: 6 })

  const dragCameraKey = await readCameraKey()
  if (!dragCameraKey || dragCameraKey === initialCameraKey) {
    throw new Error('Drag camera state did not update.')
  }

  const objectsPanel = page.getByTestId('objects-panel')
  const outsideBox = await objectsPanel.boundingBox()
  if (!outsideBox) {
    throw new Error('Objects panel bounds not found.')
  }

  await page.mouse.move(outsideBox.x + 12, outsideBox.y + 12)
  await page.mouse.up()

  await waitForFrame()
  await waitForFrame()

  const releasedCameraKey = await readCameraKey()
  if (!releasedCameraKey || releasedCameraKey === initialCameraKey) {
    throw new Error('Released camera state did not update.')
  }

  await page
    .locator('[data-testid^="object-tree-node-"]')
    .filter({ hasText: /Orbit_1/i })
    .first()
    .click()

  const finalCameraKey = await readCameraKey()
  if (!finalCameraKey) {
    throw new Error('Final camera state not found.')
  }

  expect(finalCameraKey).toBe(releasedCameraKey)
})
