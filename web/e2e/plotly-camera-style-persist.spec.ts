import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('3D camera persists across style updates', async ({ page }) => {
  test.setTimeout(60_000)

  const pageErrors: string[] = []
  page.on('pageerror', (error) => {
    pageErrors.push(error.stack ?? error.message)
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    pageErrors.push(msg.text())
  })

  await page.addInitScript(() => {
    window.__E2E__ = true
    window.__plotlyPerf = {
      reactCalls: 0,
      newPlotCalls: 0,
      resizeCalls: 0,
    }
  })

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })

  await harness.openSystem('Lorenz')
  await harness.createScene()

  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await harness.runOrbit()

  const viewport = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect(viewport).toHaveAttribute('data-trace-count', /[1-9]/)
  const viewportTestId = await viewport.getAttribute('data-testid')
  if (!viewportTestId) {
    throw new Error('Viewport test id not found.')
  }
  const plotId = viewportTestId.replace('plotly-viewport-', '')

  await page.waitForFunction(() => Boolean(window.Plotly))
  await page.waitForFunction((id) => {
    const node = document.querySelector(`[data-testid="plotly-viewport-${id}"]`) as
      | (HTMLElement & { _fullLayout?: { scene?: { camera?: unknown } } })
      | null
    return Boolean(node?._fullLayout?.scene?.camera)
  }, plotId)
  await page.waitForFunction((id) => {
    const node = document.querySelector(`[data-testid="plotly-viewport-${id}"]`)
    return Boolean(node?.classList.contains('js-plotly-plot'))
  }, plotId)

  const gd = page.locator(`[data-testid="plotly-viewport-${plotId}"]`)
  const gdHandle = await gd.elementHandle()
  if (!gdHandle) {
    throw new Error('Plotly graphDiv not found.')
  }

  const readCamera = () =>
    gdHandle.evaluate((node) => {
      if (!node || !(node as HTMLElement).isConnected) return null
      const typed = node as HTMLElement & {
        layout?: { scene?: { camera?: { eye?: { x?: number; y?: number; z?: number } } } }
        _fullLayout?: {
          scene?: {
            camera?: { eye?: { x?: number; y?: number; z?: number } }
            _scene?: { camera?: { eye?: { x?: number; y?: number; z?: number } } }
          }
        }
      }
      const camera =
        typed._fullLayout?.scene?._scene?.camera ??
        typed._fullLayout?.scene?.camera ??
        typed.layout?.scene?.camera
      if (!camera?.eye) return null
      if (Array.isArray(camera.eye) && camera.eye.length >= 3) {
        return { x: camera.eye[0], y: camera.eye[1], z: camera.eye[2] }
      }
      return camera.eye ?? null
    })

  const waitForPlotlyEvent = (eventName: 'plotly_afterplot' | 'plotly_relayout') =>
    page.evaluate(
      ({ id, eventName }) =>
        new Promise<void>((resolve) => {
          const node = document.querySelector(`[data-testid="plotly-viewport-${id}"]`) as
            | (HTMLElement & {
                on?: (event: string, handler: () => void) => void
                removeListener?: (event: string, handler: () => void) => void
                removeAllListeners?: (event: string) => void
              })
            | null
          if (!node) {
            resolve()
            return
          }
          let done = false
          const finish = () => {
            if (done) return
            done = true
            if (node.removeAllListeners) {
              node.removeAllListeners(eventName)
            } else if (node.removeListener) {
              node.removeListener(eventName, handler)
            } else {
              node.removeEventListener(eventName, handler as EventListener)
            }
            resolve()
          }
          const handler = () => {
            clearTimeout(timeout)
            finish()
          }
          const timeout = window.setTimeout(finish, 2000)
          if (node.on) {
            node.on(eventName, handler)
          } else {
            node.addEventListener(eventName, handler as EventListener)
          }
        }),
      { id: plotId, eventName }
    )

  const waitForCameraRelayout = () =>
    page.evaluate(
      (id) =>
        new Promise<void>((resolve) => {
          const node = document.querySelector(`[data-testid="plotly-viewport-${id}"]`)
          if (!node) {
            resolve()
            return
          }
          let done = false
          const finish = () => {
            if (done) return
            done = true
            node.removeEventListener('plotly_relayout', handler as EventListener)
            resolve()
          }
          const handler = (event: unknown) => {
            const payload = event as Record<string, unknown>
            if (!payload || typeof payload !== 'object') return
            if ('scene.camera' in payload) {
              clearTimeout(timeout)
              finish()
              return
            }
            const keys = Object.keys(payload)
            if (keys.some((key) => key.startsWith('scene.camera'))) {
              clearTimeout(timeout)
              finish()
            }
          }
          const timeout = window.setTimeout(finish, 2000)
          node.addEventListener('plotly_relayout', handler as EventListener)
        }),
      plotId
    )

  const distance = (
    left: { x: number; y: number; z: number },
    right: { x: number; y: number; z: number }
  ) =>
    Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)

  const readPlotState = () =>
    gdHandle.evaluate((node) => {
      if (!node || !(node as HTMLElement).isConnected) return null
      const typed = node as HTMLElement & {
        data?: unknown[]
        layout?: { uirevision?: string; scene?: { uirevision?: string } }
        _fullLayout?: { uirevision?: string; scene?: { uirevision?: string } }
      }
      const rect = typed.getBoundingClientRect()
      return {
        uirev: typed.layout?.uirevision ?? typed._fullLayout?.uirevision ?? null,
        sceneUirev:
          typed.layout?.scene?.uirevision ?? typed._fullLayout?.scene?.uirevision ?? null,
        dataLength: Array.isArray(typed.data) ? typed.data.length : null,
        box: { width: rect.width, height: rect.height },
      }
    })

  const readPerf = () => page.evaluate(() => window.__plotlyPerf)

  const diffPerf = (
    before: { reactCalls: number; newPlotCalls: number; resizeCalls: number },
    after: { reactCalls: number; newPlotCalls: number; resizeCalls: number }
  ) => ({
    reactCalls: after.reactCalls - before.reactCalls,
    newPlotCalls: after.newPlotCalls - before.newPlotCalls,
    resizeCalls: after.resizeCalls - before.resizeCalls,
  })

  const startAfterplotCapture = async () => {
    await page.evaluate((id) => {
      const node = document.querySelector(`[data-testid="plotly-viewport-${id}"]`) as
        | (HTMLElement & {
            layout?: { scene?: { camera?: { eye?: unknown } } }
            _fullLayout?: {
              scene?: {
                camera?: { eye?: unknown }
                _scene?: { camera?: { eye?: unknown } }
              }
            }
          })
        | null
      if (!node) return
      const toEye = (value: unknown) => {
        if (!value) return null
        if (Array.isArray(value) && value.length >= 3) {
          const [x, y, z] = value
          if ([x, y, z].every((entry) => typeof entry === 'number')) {
            return { x, y, z }
          }
        }
        if (typeof value === 'object') {
          const obj = value as Record<string, unknown>
          if (
            typeof obj.x === 'number' &&
            typeof obj.y === 'number' &&
            typeof obj.z === 'number'
          ) {
            return { x: obj.x, y: obj.y, z: obj.z }
          }
        }
        return null
      }
      const readEye = () => {
        const camera =
          node._fullLayout?.scene?._scene?.camera ??
          node._fullLayout?.scene?.camera ??
          node.layout?.scene?.camera
        return toEye(camera?.eye)
      }
      ;(window as { __camsAfterStyle?: Array<{ x: number; y: number; z: number } | null> })
        .__camsAfterStyle = []
      const handler = () => {
        const eye = readEye()
        ;(window as { __camsAfterStyle?: Array<{ x: number; y: number; z: number } | null> })
          .__camsAfterStyle?.push(eye ?? null)
      }
      if (node.on) {
        node.on('plotly_afterplot', handler)
      } else {
        node.addEventListener('plotly_afterplot', handler)
      }
      ;(window as { __camAfterplotCleanup?: () => void }).__camAfterplotCleanup = () => {
        if (node.removeAllListeners) {
          node.removeAllListeners('plotly_afterplot')
        } else if (node.removeListener) {
          node.removeListener('plotly_afterplot', handler)
        } else {
          node.removeEventListener('plotly_afterplot', handler)
        }
      }
    }, plotId)
  }

  const stopAfterplotCapture = async () => {
    await page.evaluate(() => {
      const win = window as { __camAfterplotCleanup?: () => void; __camsAfterStyle?: unknown }
      win.__camAfterplotCleanup?.()
      win.__camAfterplotCleanup = undefined
    })
  }

  const readAfterplotCams = async () =>
    page.evaluate(() => {
      const win = window as {
        __camsAfterStyle?: Array<{ x: number; y: number; z: number } | null>
      }
      return win.__camsAfterStyle ?? []
    })

  const assertNoPlotlyErrors = async (label: string) => {
    if (pageErrors.length > 0) {
      throw new Error(`Page error after ${label}:\n${pageErrors.join('\n')}`)
    }
    await expect(viewport).not.toContainText(/Cannot read properties of undefined/)
    await expect(viewport).not.toContainText(/reading '0'/)
  }

  await waitForPlotlyEvent('plotly_afterplot')
  const plotIdentityBefore = await gdHandle.evaluate((node) => {
    const typed = node as HTMLElement & {
      _fullLayout?: { _uid?: string; uirevision?: string }
      layout?: { uirevision?: string }
      dataset?: DOMStringMap
    }
    if (typed.dataset) {
      typed.dataset.e2eMarker = 'kept'
    }
    return {
      uid: typed._fullLayout?._uid ?? null,
      uirev: typed.layout?.uirevision ?? typed._fullLayout?.uirevision ?? null,
      marker: typed.dataset?.e2eMarker ?? null,
    }
  })

  const defaultCam = await readCamera()
  if (!defaultCam) {
    throw new Error('Initial camera state not found.')
  }
  const viewportBox = await viewport.boundingBox()
  if (!viewportBox) {
    throw new Error('Plotly viewport bounds not found.')
  }

  const dragStartX = viewportBox.x + viewportBox.width * 0.5
  const dragStartY = viewportBox.y + viewportBox.height * 0.5

  const relayoutWait = waitForCameraRelayout()
  await page.mouse.move(dragStartX, dragStartY)
  await page.mouse.down()
  await page.mouse.move(dragStartX + 120, dragStartY + 60, { steps: 6 })
  await page.mouse.up()
  await relayoutWait
  await waitForPlotlyEvent('plotly_afterplot')

  const rotatedCam = await readCamera()
  if (!rotatedCam) {
    throw new Error('Rotated camera state not found.')
  }
  expect(distance(rotatedCam, defaultCam)).toBeGreaterThan(0.2)
  await assertNoPlotlyErrors('camera rotate')

  const lineWidthInput = page.getByTestId('inspector-line-width')
  await startAfterplotCapture()
  const perfBeforeFirst = await readPerf()
  const stateBeforeFirst = await readPlotState()
  const lineWidthAfterFirst = waitForPlotlyEvent('plotly_afterplot')
  await lineWidthInput.fill('6')
  await lineWidthInput.blur()
  await lineWidthAfterFirst
  await page.waitForFunction(() => {
    const win = window as { __camsAfterStyle?: Array<unknown> }
    return Boolean(win.__camsAfterStyle && win.__camsAfterStyle.length >= 1)
  })
  const camsAfterFirst = await readAfterplotCams()
  await stopAfterplotCapture()
  const perfAfterFirst = await readPerf()
  const stateAfterFirst = await readPlotState()
  const afterCam1 = await readCamera()
  if (!afterCam1) {
    throw new Error('Camera state missing after first style update.')
  }
  await assertNoPlotlyErrors('first style update')
  if (camsAfterFirst.length === 0 || !camsAfterFirst[0]) {
    throw new Error('No afterplot camera samples captured for first style update.')
  }
  const firstAfterplotCam = camsAfterFirst[0]
  expect(distance(firstAfterplotCam, rotatedCam)).toBeLessThan(0.25)
  expect(distance(firstAfterplotCam, defaultCam)).toBeGreaterThan(0.2)

  await startAfterplotCapture()
  const perfBeforeSecond = await readPerf()
  const stateBeforeSecond = await readPlotState()
  const lineWidthAfterSecond = waitForPlotlyEvent('plotly_afterplot')
  await lineWidthInput.fill('7')
  await lineWidthInput.blur()
  await lineWidthAfterSecond
  await page.waitForFunction(() => {
    const win = window as { __camsAfterStyle?: Array<unknown> }
    return Boolean(win.__camsAfterStyle && win.__camsAfterStyle.length >= 1)
  })
  const camsAfterSecond = await readAfterplotCams()
  await stopAfterplotCapture()
  const perfAfterSecond = await readPerf()
  const stateAfterSecond = await readPlotState()
  const afterCam2 = await readCamera()
  if (!afterCam2) {
    throw new Error('Camera state missing after second style update.')
  }
  await assertNoPlotlyErrors('second style update')
  if (camsAfterSecond.length === 0 || !camsAfterSecond[0]) {
    throw new Error('No afterplot camera samples captured for second style update.')
  }
  const secondAfterplotCam = camsAfterSecond[0]
  expect(distance(secondAfterplotCam, rotatedCam)).toBeLessThan(0.25)
  expect(distance(secondAfterplotCam, defaultCam)).toBeGreaterThan(0.2)

  const viewportCountBefore = await page.locator('[data-testid^="plotly-viewport-"]').count()
  const insertAfterViewport = page.getByTestId(`viewport-insert-${plotId}`)
  await insertAfterViewport.click()
  await page.getByTestId('viewport-create-scene').click()
  await expect(page.locator('[data-testid^="plotly-viewport-"]')).toHaveCount(
    viewportCountBefore + 1
  )
  await assertNoPlotlyErrors('create viewport')

  const uirevision = await page.evaluate((id) => {
    const node = document.querySelector(`[data-testid="plotly-viewport-${id}"]`) as
      | (HTMLElement & {
          layout?: { uirevision?: string; scene?: { uirevision?: string } }
          _fullLayout?: { uirevision?: string; scene?: { uirevision?: string } }
        })
      | null
    return {
      layout: node?.layout?.uirevision ?? null,
      fullLayout: node?._fullLayout?.uirevision ?? null,
      scene: node?._fullLayout?.scene?.uirevision ?? node?.layout?.scene?.uirevision ?? null,
    }
  }, plotId)
  const resolvedUirev = uirevision.fullLayout ?? uirevision.layout
  expect(resolvedUirev).toBeTruthy()
  expect(uirevision.scene).toBeTruthy()
  if (resolvedUirev) {
    expect(resolvedUirev.startsWith(plotId)).toBe(true)
  }
  if (uirevision.scene) {
    expect(uirevision.scene.startsWith(plotId)).toBe(true)
  }

  await expect(gd).toBeAttached()
  const isConnected = await gdHandle.evaluate((node) => (node as HTMLElement).isConnected)
  const plotIdentityAfter = await gdHandle.evaluate((node) => {
    const typed = node as HTMLElement & {
      _fullLayout?: { _uid?: string; uirevision?: string }
      layout?: { uirevision?: string }
      dataset?: DOMStringMap
    }
    return {
      uid: typed._fullLayout?._uid ?? null,
      uirev: typed.layout?.uirevision ?? typed._fullLayout?.uirevision ?? null,
      marker: typed.dataset?.e2eMarker ?? null,
    }
  })

  const distToRotated1 = distance(afterCam1, rotatedCam)
  const distToDefault1 = distance(afterCam1, defaultCam)
  const distToRotated2 = distance(afterCam2, rotatedCam)
  const distToDefault2 = distance(afterCam2, defaultCam)
  const perfDeltaFirst =
    perfBeforeFirst && perfAfterFirst ? diffPerf(perfBeforeFirst, perfAfterFirst) : null
  const perfDeltaSecond =
    perfBeforeSecond && perfAfterSecond ? diffPerf(perfBeforeSecond, perfAfterSecond) : null
  const shouldLog =
    distToRotated1 >= 0.25 ||
    distToDefault1 <= 0.2 ||
    distToRotated2 >= 0.25 ||
    distToDefault2 <= 0.2 ||
    !isConnected ||
    plotIdentityBefore.uid !== plotIdentityAfter.uid ||
    plotIdentityBefore.uirev !== plotIdentityAfter.uirev ||
    (perfDeltaFirst?.newPlotCalls ?? 0) > 0 ||
    (perfDeltaSecond?.newPlotCalls ?? 0) > 0
  if (shouldLog) {
    console.log('plotly-camera-diag', {
      isConnected,
      plotIdentityBefore,
      plotIdentityAfter,
      perfBeforeFirst,
      perfAfterFirst,
      perfBeforeSecond,
      perfAfterSecond,
      perfDeltaFirst,
      perfDeltaSecond,
      defaultCam,
      rotatedCam,
      afterCam1,
      afterCam2,
      distToRotated1,
      distToDefault1,
      distToRotated2,
      distToDefault2,
      stateBeforeFirst,
      stateAfterFirst,
      stateBeforeSecond,
      stateAfterSecond,
    })
  }
  expect(isConnected).toBe(true)
  expect(plotIdentityAfter.uid).toBe(plotIdentityBefore.uid)
  expect(plotIdentityAfter.uirev).toBe(plotIdentityBefore.uirev)
  expect(perfDeltaFirst?.newPlotCalls ?? 0).toBe(0)
  expect(perfDeltaSecond?.newPlotCalls ?? 0).toBe(0)
  expect(distToRotated1).toBeLessThan(0.25)
  expect(distToDefault1).toBeGreaterThan(0.2)
  expect(distToRotated2).toBeLessThan(0.25)
  expect(distToDefault2).toBeGreaterThan(0.2)
})
