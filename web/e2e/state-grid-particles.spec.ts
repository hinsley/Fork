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
