import { expect, test, type Locator } from '@playwright/test'
import { clickInspectorAction, createHarness } from './harness'

async function readParticles(plot: Locator) {
  return plot.evaluate((element) => {
    const target = element as HTMLElement & { data?: Array<{ name?: string; x: number[]; y: number[]; z?: number[]; marker: { color: string[] } }> }
    const trace = target.data?.find((trace) => trace.name?.includes('_Particles_'))
    return trace ? { x: trace.x, y: trace.y, z: trace.z, colors: trace.marker.color } : null
  })
}

for (const storage of ['opfs', 'indexeddb']) test(`flow grid particles animate, pause, retain bounds, and persist as a child (${storage})`, async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const harness = createHarness(page)
  if (storage === 'indexeddb') await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined })
  })
  await harness.goto({ deterministic: false, mock: false })
  await harness.openSystem('Lorenz')
  await harness.createScene()
  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-state-grid').click()
  await clickInspectorAction(page, 'action-state-grid-setup-toggle')
  for (const [axis, min, max] of [['x', '-30', '30'], ['y', '-30', '30'], ['z', '0', '55']]) {
    await page.getByTestId(`state-grid-${axis}-min`).fill(min)
    await page.getByTestId(`state-grid-${axis}-max`).fill(max)
    await page.getByTestId(`state-grid-${axis}-resolution`).fill('5')
  }
  await page.getByTestId('inspector-workflow-back').click()
  await clickInspectorAction(page, 'action-state-grid-particles-toggle')
  await page.getByTestId('state-grid-create-particles').click()
  await expect(page.getByTestId('particle-inspector')).toBeVisible()
  await expect(page.getByRole('button', { name: 'State_Grid_1_Particles_1 (particles)', exact: true })).toBeVisible()
  const plot = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect.poll(async () => (await readParticles(plot))?.x.length ?? 0).toBeGreaterThan(250)
  const initial = await readParticles(plot)
  await expect.poll(async () => (await readParticles(plot))?.x[0]).not.toBe(initial?.x[0])
  await clickInspectorAction(page, 'action-particles-animation-toggle')
  await expect(page.getByTestId('particles-speed')).toBeVisible()
  await page.getByTestId('particles-speed').fill('2')
  await page.getByTestId('particles-lifetime').fill('3')
  await page.getByTestId('particles-play').click()
  await expect(page.getByTestId('particles-play')).toHaveText('Play')
  await page.waitForTimeout(400)
  const paused = await readParticles(plot)
  await page.waitForTimeout(250)
  expect(await readParticles(plot)).toEqual(paused)
  expect(paused!.x.every((x) => x >= -30 && x <= 30)).toBe(true)
  expect(paused!.y.every((y) => y >= -30 && y <= 30)).toBe(true)
  expect(paused!.z!.every((z) => z >= 0 && z <= 55)).toBe(true)
  expect(new Set(paused!.colors).size).toBeGreaterThan(10)
  await page.screenshot({ path: 'test-results/particles-lorenz.png', fullPage: true })
  await page.reload()
  await harness.openSystem('Lorenz')
  await harness.selectTreeNode('State_Grid_1_Particles_1')
  await clickInspectorAction(page, 'action-particles-animation-toggle')
  await expect(page.getByTestId('particles-speed')).toBeVisible()
  await expect(page.getByTestId('particles-speed')).toHaveValue('2')
  await expect(page.getByTestId('particles-lifetime')).toHaveValue('3')
  await expect(page.getByTestId('particles-play')).toHaveText('Play')
  await page.getByTestId('particles-play').click()
  await expect.poll(async () => (await readParticles(plot))?.x.length ?? 0).toBeGreaterThan(250)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('map grids do not offer particles', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto()
  await harness.openSystem('LogisticMap')
  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-state-grid').click()
  await expect(page.getByTestId('action-state-grid-particles-toggle')).toHaveCount(0)
})

test('live particles leave dense scene bounds and static buffers alone while rotating', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const harness = createHarness(page)
  await harness.goto({ mock: false })
  await harness.openSystem('Lorenz')
  await harness.createScene()
  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-state-grid').click()
  await clickInspectorAction(page, 'action-state-grid-setup-toggle')
  for (const [axis, min, max] of [['x', '-30', '30'], ['y', '-30', '30'], ['z', '0', '55']]) {
    await page.getByTestId(`state-grid-${axis}-min`).fill(min)
    await page.getByTestId(`state-grid-${axis}-max`).fill(max)
    await page.getByTestId(`state-grid-${axis}-resolution`).fill('25')
  }
  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-state-grid').click()
  await clickInspectorAction(page, 'action-state-grid-particles-toggle')
  await page.getByTestId('state-grid-create-particles').click()
  const plot = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect.poll(async () => (await readParticles(plot))?.x.length ?? 0).toBeGreaterThan(125)
  await plot.evaluate((element) => {
    const target = element as unknown as {
      _fullLayout: { scene: { _scene: {
        plot: (...args: unknown[]) => unknown
        traces: Record<string, { data: { name: string }; update: (...args: unknown[]) => unknown }>
        getCamera: () => unknown
      }; xaxis: { range: number[] }; yaxis: { range: number[] }; zaxis: { range: number[] } } }
    }
    const scene = target._fullLayout.scene._scene
    const stats = { scenePlots: 0, staticUpdates: 0, particleUpdates: 0, camera: scene.getCamera(),
      ranges: [target._fullLayout.scene.xaxis.range, target._fullLayout.scene.yaxis.range, target._fullLayout.scene.zaxis.range] }
    Object.assign(element, { particleStats: stats })
    const originalPlot = scene.plot
    scene.plot = function (...args) { stats.scenePlots++; return originalPlot.apply(this, args) }
    for (const trace of Object.values(scene.traces)) {
      const update = trace.update
      trace.update = function (...args) {
        if (trace.data.name.includes('_Particles_')) stats.particleUpdates++
        else stats.staticUpdates++
        return update.apply(this, args)
      }
    }
  })
  const bounds = (await plot.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.65, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(1000)
  const stats = await plot.evaluate((element) => {
    const target = element as unknown as {
      particleStats: { scenePlots: number; staticUpdates: number; particleUpdates: number; camera: unknown; ranges: number[][] }
      _fullLayout: { scene: { _scene: { getCamera: () => unknown }; xaxis: { range: number[] }; yaxis: { range: number[] }; zaxis: { range: number[] } } }
    }
    return { ...target.particleStats, currentCamera: target._fullLayout.scene._scene.getCamera(),
      currentRanges: [target._fullLayout.scene.xaxis.range, target._fullLayout.scene.yaxis.range, target._fullLayout.scene.zaxis.range] }
  })
  expect(stats.scenePlots).toBe(0)
  expect(stats.staticUpdates).toBe(0)
  expect(stats.particleUpdates).toBeGreaterThan(5)
  expect(stats.currentRanges).toEqual(stats.ranges)
  expect(stats.currentCamera).not.toEqual(stats.camera)
  await page.waitForTimeout(400)
  const camera = await plot.evaluate((element) => (element as unknown as {
    _fullLayout: { scene: { _scene: { getCamera: () => unknown } } }
  })._fullLayout.scene._scene.getCamera())
  expect(camera).toEqual(stats.currentCamera)
  await harness.selectTreeNode('State_Grid_2_Particles_1')
  await clickInspectorAction(page, 'action-appearance-toggle')
  await expect(page.getByTestId('particles-opacity')).toBeVisible()
  await expect(page.getByTestId('particles-speed')).not.toBeVisible()
  await page.screenshot({ path: 'test-results/particles-live-rotation.png' })
})

for (const dimension of [2, 3]) test(`grid-seeded continuous particles escape and expand a ${dimension}D view`, async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const harness = createHarness(page)
  await harness.goto({ mock: false })
  if (dimension === 3) await harness.openSystem('Lorenz')
  else await harness.createSystem('Particle_Translation')
  await page.getByTestId('open-system-settings').click()
  for (let index = 0; index < dimension; index++) await page.getByTestId(`system-eq-${index}`).fill(index === 0 ? '10' : '0')
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await page.getByTestId('close-system-settings').click()
  await harness.createScene()
  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-state-grid').click()
  await clickInspectorAction(page, 'action-state-grid-particles-toggle')
  await page.getByTestId('state-grid-create-particles').click()
  await clickInspectorAction(page, 'action-appearance-toggle')
  await page.getByTestId('particles-trailLength-number').fill('0')
  await expect(page.getByTestId('particles-trailLength')).toHaveValue('0')
  await page.getByTestId('particles-pointSize-number').fill('7.5')
  await expect(page.getByTestId('particles-pointSize')).toHaveValue('7.5')
  await page.getByTestId('particles-pointSize').fill('5')
  await expect(page.getByTestId('particles-pointSize-number')).toHaveValue('5')
  await page.getByTestId('inspector-workflow-back').click()
  await clickInspectorAction(page, 'action-particles-animation-toggle')
  await expect(page.getByTestId('particles-count')).toHaveCount(0)
  await page.getByTestId('particles-lifetime').fill('0.1')
  await page.getByTestId('particles-mode').selectOption('continuous')
  await expect(page.getByTestId('particles-lifetime')).toHaveCount(0)
  await page.getByTestId('particles-play').click()
  await page.getByTestId('particles-reset').click()
  const plot = page.locator('[data-testid^="plotly-viewport-"]').first()
  const seeds = await plot.evaluate((element) => {
    const data = (element as unknown as { data: Array<{ name: string; x: number[]; y: number[]; z?: number[] }> }).data
    const grid = data.find((trace) => trace.name === 'State_Grid_1')!
    return { x: grid.x, y: grid.y, z: grid.z }
  })
  await expect.poll(async () => (await readParticles(plot))?.x).toEqual(seeds.x)
  expect((await readParticles(plot))?.y).toEqual(seeds.y)
  expect(seeds.x).toHaveLength(5 ** dimension)
  if (dimension === 3) {
    expect((await readParticles(plot))?.z).toEqual(seeds.z)
    await plot.evaluate((element) => {
      const scene = (element as unknown as { _fullLayout: { scene: { _scene: { plot: (...args: unknown[]) => unknown } } } })._fullLayout.scene._scene
      const stats = { plots: 0 }
      Object.assign(element, { expansionStats: stats })
      const original = scene.plot
      scene.plot = function (...args) { stats.plots++; return original.apply(this, args) }
    })
  }
  await page.getByTestId('particles-play').click()
  await expect.poll(async () => Math.max(...((await readParticles(plot))?.x ?? [-Infinity]))).toBeGreaterThan(2.5)
  if (dimension === 3) await plot.evaluate((element) => {
    (element as unknown as { expansionStats: { plots: number } }).expansionStats.plots = 0
  })
  await expect.poll(async () => Math.min(...((await readParticles(plot))?.x ?? [-Infinity]))).toBeGreaterThan(4)
  if (dimension === 3) expect(await plot.evaluate((element) =>
    (element as unknown as { expansionStats: { plots: number } }).expansionStats.plots)).toBe(0)
  await page.screenshot({ path: `test-results/particles-continuous-live-${dimension}d.png` })
  await page.getByTestId('particles-play').click()
  await page.waitForTimeout(150)
  const evolved = await readParticles(plot)
  expect(evolved!.x).toHaveLength(seeds.x.length)
  expect(evolved!.y).toEqual(seeds.y)
  expect(Math.max(...evolved!.x) - Math.min(...evolved!.x)).toBeCloseTo(3.2, 5)
  const extent = await plot.evaluate((element, dim) => {
    const target = element as unknown as {
      expansionStats?: { plots: number }
      _fullLayout: { xaxis: { range: number[] }; scene: { _scene: { dataScale: number[]; glplot: { bounds: number[][] } } } }
    }
    if (dim === 2) return { max: target._fullLayout.xaxis.range[1], plots: 0 }
    const scene = target._fullLayout.scene._scene
    return { max: scene.glplot.bounds[1][0] / scene.dataScale[0], plots: target.expansionStats!.plots }
  }, dimension)
  expect(extent.max).toBeGreaterThanOrEqual(Math.max(...evolved!.x))
  await page.screenshot({ path: `test-results/particles-continuous-${dimension}d.png` })
  await page.getByTestId('particles-reset').click()
  await expect.poll(async () => (await readParticles(plot))?.x).toEqual(seeds.x)
  await page.getByTestId('particles-mode').selectOption('bounded')
  await expect.poll(async () => (await readParticles(plot))?.x).toEqual(seeds.x)
})
