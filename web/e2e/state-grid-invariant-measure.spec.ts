import { expect, test, type Locator, type Page } from '@playwright/test'
import { createHarness } from './harness'

async function plotHasTrace(plot: Locator, name: string): Promise<boolean> {
  return await plot.evaluate((element, traceName) => {
    const ownPlotElement = element as HTMLElement & { data?: Array<{ name?: string }> }
    const plotElement = ownPlotElement.data
      ? ownPlotElement
      : (element.querySelector('.js-plotly-plot') as
          | (HTMLElement & { data?: Array<{ name?: string }> })
          | null)
    return Boolean(plotElement?.data?.some((trace) => trace.name === traceName))
  }, name)
}

async function readMeasureTrace(plot: Locator, name: string) {
  return await plot.evaluate((element, traceName) => {
    const ownPlotElement = element as HTMLElement & {
      data?: Array<{
        name?: string
        x?: unknown[]
        customdata?: Array<[number, number]>
        hovertemplate?: string
        marker?: { color?: string | string[]; opacity?: number[]; size?: number }
      }>
    }
    const plotElement = ownPlotElement.data
      ? ownPlotElement
      : (element.querySelector('.js-plotly-plot') as typeof ownPlotElement | null)
    const trace = plotElement?.data?.find((entry) => entry.name === traceName)
    if (!trace) return null
    const colors = Array.isArray(trace.marker?.color) ? trace.marker.color : []
    const opacities = Array.isArray(trace.marker?.opacity) ? trace.marker.opacity : []
    const masses = Array.isArray(trace.customdata)
      ? trace.customdata.map((entry) => entry[1])
      : []
    return {
      pointCount: trace.x?.length ?? 0,
      massCount: masses.length,
      massSum: masses.reduce((sum, mass) => sum + mass, 0),
      uniqueColors: new Set(colors).size,
      uniqueOpacities: new Set(opacities).size,
      markerSize: trace.marker?.size ?? null,
      hoverTemplate: trace.hovertemplate ?? '',
    }
  }, name)
}

async function openStateGridWorkflow(page: Page, workflow: string) {
  await page.getByTestId(`action-${workflow}`).click()
}

test('State Grid creates a separately rendered and persisted invariant-measure object', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('LogisticMap')
  await harness.createScene()

  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-object-menu').waitFor()
  await page.getByTestId('create-state-grid').click()
  await openStateGridWorkflow(page, 'state-grid-setup-toggle')
  await page.getByTestId('state-grid-x-min').fill('0')
  await page.getByTestId('state-grid-x-max').fill('1')
  await page.getByTestId('state-grid-x-resolution').fill('100')

  await page.getByTestId('inspector-workflow-back').click()
  await openStateGridWorkflow(page, 'state-grid-transfer-toggle')
  await expect(page.getByTestId('state-grid-transfer-samples-per-cell')).toHaveValue('4')
  await expect(page.getByTestId('state-grid-transfer-iterations')).toHaveValue('1')
  await page.getByTestId('state-grid-create-invariant-measure').click()

  const measureName = 'Invariant_Measure_State_Grid_1'
  await expect(page.getByTestId('inspector-name')).toHaveValue(measureName, {
    timeout: 30_000,
  })
  await expect(page.getByText(/occupied cells$/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: `${measureName} (invariant measure)`, exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'State_Grid_1 (state grid)', exact: true })
  ).toBeVisible()

  await page.getByTestId('action-invariant-measure-data-toggle').click()
  await expect(page.getByTestId('invariant-measure-source')).toHaveText('State_Grid_1')
  await expect(page.getByTestId('invariant-measure-occupied-cells')).toHaveText('94 / 100')
  await expect(page.getByTestId('invariant-measure-residual')).not.toHaveText('NaN')

  const plot = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect.poll(() => plotHasTrace(plot, measureName)).toBe(true)
  const trace = await readMeasureTrace(plot, measureName)
  expect(trace).toMatchObject({
    pointCount: 94,
    massCount: 94,
    markerSize: 4,
  })
  expect(trace?.uniqueOpacities).toBeGreaterThan(1)
  expect(trace?.massSum).toBeCloseTo(1, 10)
  expect(trace?.hoverTemplate).toContain('mass=')

  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-appearance-toggle').click()
  await page.getByTestId('inspector-visibility').click()
  await expect.poll(() => plotHasTrace(plot, measureName)).toBe(false)
  await page.getByTestId('inspector-visibility').click()
  await expect.poll(() => plotHasTrace(plot, measureName)).toBe(true)

  await page.getByTestId('open-systems').click()
  await page.getByRole('button', { name: 'LogisticMap', exact: true }).click()
  await harness.selectTreeNode(measureName)
  if (await page.getByTestId('inspector-workflow-back').isVisible()) {
    await page.getByTestId('inspector-workflow-back').click()
  }
  await expect(page.getByTestId('inspector-name')).toHaveValue(measureName)
  await expect.poll(() => plotHasTrace(plot, measureName)).toBe(true)
})

test('State Grid creates a sampled flow-map measure for an autonomous flow', async ({ page }) => {
  test.setTimeout(120_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('Lorenz')
  await harness.createScene()

  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-object-menu').waitFor()
  await page.getByTestId('create-state-grid').click()
  await openStateGridWorkflow(page, 'state-grid-transfer-toggle')
  await expect(page.getByTestId('state-grid-transfer-time-step')).toHaveValue('0.01')
  await expect(page.getByText(/sampled flow map/)).toBeVisible()
  await page.getByTestId('state-grid-create-invariant-measure').click()

  const measureName = 'Invariant_Measure_State_Grid_1'
  await expect(page.getByTestId('inspector-name')).toHaveValue(measureName, {
    timeout: 30_000,
  })
  await page.getByTestId('action-invariant-measure-data-toggle').click()
  await expect(page.getByTestId('invariant-measure-data-section')).toContainText(
    'fixed-time sampled flow map'
  )
  await expect(page.getByTestId('invariant-measure-residual')).not.toHaveText('NaN')
})
