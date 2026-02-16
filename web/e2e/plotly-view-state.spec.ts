import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

const readCameraKey = (page: Page) =>
  page.evaluate(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
      | (HTMLElement & {
          layout?: { scene?: { camera?: { eye?: { x?: number; y?: number; z?: number } } } }
          _fullLayout?: {
            scene?: {
              uirevision?: string | number
              camera?: { eye?: { x?: number; y?: number; z?: number } }
              _scene?: { camera?: { eye?: { x?: number; y?: number; z?: number } } }
            }
            uirevision?: string | number
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
    const formatCoord = (value: number) => {
      const rounded = Number(value.toFixed(4))
      const normalized = Object.is(rounded, -0) ? 0 : rounded
      return normalized.toFixed(4)
    }
    return `${formatCoord(eye.x)}|${formatCoord(eye.y)}|${formatCoord(eye.z)}`
  })

const readSceneUirevision = (page: Page) =>
  page.evaluate(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
      | (HTMLElement & {
          _fullLayout?: { uirevision?: string | number; scene?: { uirevision?: string | number } }
        })
      | null
    return {
      layout: node?._fullLayout?.uirevision ?? null,
      scene: node?._fullLayout?.scene?.uirevision ?? null,
    }
  })

const setCamera = (
  page: Page,
  camera: {
    eye: { x: number; y: number; z: number }
    center: { x: number; y: number; z: number }
    up: { x: number; y: number; z: number }
  }
) =>
  page.evaluate(async (next) => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as HTMLElement | null
    const Plotly = (window as unknown as {
      Plotly?: { relayout?: (target: HTMLElement, update: Record<string, unknown>) => Promise<void> }
    }).Plotly
    if (!node || !Plotly?.relayout) return false
    await Plotly.relayout(node, { 'scene.camera': next })
    return true
  }, camera)

const waitForFrame = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

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

  const initialCameraKey = await readCameraKey(page)
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

  const dragCameraKey = await readCameraKey(page)
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

  await waitForFrame(page)
  await waitForFrame(page)

  const releasedCameraKey = await readCameraKey(page)
  if (!releasedCameraKey || releasedCameraKey === initialCameraKey) {
    throw new Error('Released camera state did not update.')
  }

  await page
    .locator('[data-testid^="object-tree-node-"]')
    .filter({ hasText: /Orbit_1/i })
    .first()
    .click()

  const finalCameraKey = await readCameraKey(page)
  if (!finalCameraKey) {
    throw new Error('Final camera state not found.')
  }

  expect(finalCameraKey).toBe(releasedCameraKey)
})

test('plotly 3d camera persists across style-only updates', async ({ page }) => {
  test.setTimeout(60_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.openSystem('Lorenz')
  await harness.createScene()

  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await harness.runOrbit()

  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_2')
  await harness.runOrbit()

  const viewport = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect(viewport).toHaveAttribute('data-trace-count', /[2-9]/)

  await page.evaluate(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]')
    ;(window as unknown as { __plotlyNode?: Element }).__plotlyNode = node ?? undefined
  })

  const initialCameraKey = await readCameraKey(page)
  if (!initialCameraKey) {
    throw new Error('Initial camera state not found.')
  }

  const cameraOverride = {
    eye: { x: 2.1, y: 1.4, z: 1.2 },
    center: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
  }
  const applied = await setCamera(page, cameraOverride)
  if (!applied) {
    throw new Error('Plotly.relayout was not available in the browser context.')
  }

  await page.waitForFunction(
    (expected) => {
      const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
        | (HTMLElement & {
            _fullLayout?: {
              scene?: {
                camera?: { eye?: { x?: number; y?: number; z?: number } }
                _scene?: { camera?: { eye?: { x?: number; y?: number; z?: number } } }
              }
            }
          })
        | null
      const camera = node?._fullLayout?.scene?._scene?.camera ?? node?._fullLayout?.scene?.camera
      const eye =
        camera && Array.isArray(camera.eye) && camera.eye.length >= 3
          ? { x: camera.eye[0], y: camera.eye[1], z: camera.eye[2] }
          : camera?.eye
      if (!eye) return false
      const formatCoord = (value: number) => {
        const rounded = Number(value.toFixed(4))
        const normalized = Object.is(rounded, -0) ? 0 : rounded
        return normalized.toFixed(4)
      }
      const key = `${formatCoord(eye.x)}|${formatCoord(eye.y)}|${formatCoord(eye.z)}`
      return key === expected
    },
    `${Number(cameraOverride.eye.x.toFixed(4)).toFixed(4)}|${Number(cameraOverride.eye.y.toFixed(4)).toFixed(4)}|${Number(cameraOverride.eye.z.toFixed(4)).toFixed(4)}`
  )

  const releasedCameraKey = await readCameraKey(page)
  if (!releasedCameraKey || releasedCameraKey === initialCameraKey) {
    throw new Error('Camera override did not apply.')
  }

  const uirevisionBefore = await readSceneUirevision(page)

  await harness.selectTreeNode('Orbit_1')

  await waitForFrame(page)
  await waitForFrame(page)

  const afterCameraKey = await readCameraKey(page)
  if (!afterCameraKey) {
    throw new Error('Camera state not found after style change.')
  }

  const uirevisionAfter = await readSceneUirevision(page)
  const nodeStable = await page.evaluate(() => {
    const current = document.querySelector('[data-testid^="plotly-viewport-"]')
    const cached = (window as unknown as { __plotlyNode?: Element }).__plotlyNode
    return Boolean(current && cached && current === cached)
  })

  expect(afterCameraKey).toBe(releasedCameraKey)
  expect(uirevisionAfter).toEqual(uirevisionBefore)
  expect(nodeStable).toBe(true)
})
