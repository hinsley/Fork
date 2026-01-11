import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('clicking a CLV arrow selects the orbit', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.openSystem('Lorenz')
  await harness.createScene()

  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await harness.runOrbit()

  await expect(page.getByText('No orbit samples stored yet.')).toHaveCount(0)

  await page.getByTestId('oseledets-toggle').click()
  await page.getByTestId('clv-submit').click()
  await expect(page.getByText('Covariant Lyapunov vectors not computed yet.')).toHaveCount(0)

  await page.getByTestId('clv-plot-toggle').click()
  await page.getByTestId('clv-plot-enabled').check()

  await harness.createEquilibrium()
  await harness.selectTreeNode('Equilibrium_1')
  await expect(harness.inspectorName()).toHaveValue(/Equilibrium_1/i)

  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as any
    return Boolean(node?.data?.some((trace: any) => trace?.type === 'cone'))
  })

  await page.evaluate(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as any
    if (!node) throw new Error('Plotly viewport not found')
    const trace = node.data?.find((entry: any) => entry?.type === 'cone')
    if (!trace) throw new Error('CLV cone trace not found')
    if (typeof trace.uid !== 'string') throw new Error('CLV trace uid missing')
    if (typeof node.emit !== 'function') throw new Error('Plotly emit missing')
    node.emit('plotly_click', { points: [{ data: trace }] })
  })

  await expect(harness.inspectorName()).toHaveValue(/Orbit_1/i)
})
