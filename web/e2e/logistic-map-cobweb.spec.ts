import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

// Regression: 1D map scenes (cobweb projection) crashed Plotly with
// "Cannot read properties of undefined (reading 'anchor')" because the layout
// carried `yaxis2: undefined` whenever no state-grid measure axis was shown.
test('logistic map scene renders the cobweb plot with an orbit', async ({ page }) => {
  test.setTimeout(90_000)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('LogisticMap')
  await harness.createScene()

  const viewport = page.getByTestId('viewport-workspace')
  const plot = viewport.locator('.js-plotly-plot').first()
  await expect(plot).toBeVisible()
  await expect(plot.locator('.main-svg').first()).toBeAttached()
  await expect(viewport.locator('.plotly-viewport__overlay.is-error')).toHaveCount(0)

  await harness.createOrbit()
  await harness.runOrbit()

  // Map function graph + diagonal + the orbit (cobweb staircase and/or points).
  await expect
    .poll(() => plot.evaluate((node) => (node as unknown as { data?: unknown[] }).data?.length ?? 0))
    .toBeGreaterThanOrEqual(3)
  await expect(viewport.locator('.plotly-viewport__overlay.is-error')).toHaveCount(0)
  await expect(viewport.getByText(/reading 'anchor'/)).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
