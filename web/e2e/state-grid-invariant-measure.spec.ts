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
  await expect(page.getByTestId('state-grid-transfer-starting-point-0')).toHaveValue('0.5')
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
  await expect(page.getByTestId('invariant-measure-residual')).not.toHaveText('NaN')
  const coverText = await page.getByTestId('invariant-measure-cover-size').innerText()
  const [coverSize, ambientSize] = coverText.split('/').map((value) => Number(value.trim()))
  expect(ambientSize).toBe(100)
  expect(coverSize).toBeGreaterThan(1)
  expect(coverSize).toBeLessThan(ambientSize)
  const occupiedText = await page.getByTestId('invariant-measure-occupied-cells').innerText()
  const [occupiedSize, occupiedCoverSize] = occupiedText
    .split('/')
    .map((value) => Number(value.trim()))
  expect(occupiedCoverSize).toBe(coverSize)
  expect(occupiedSize).toBeGreaterThan(0)
  expect(occupiedSize).toBeLessThanOrEqual(coverSize)

  const plot = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect.poll(() => plotHasTrace(plot, measureName)).toBe(true)
  const trace = await readMeasureTrace(plot, measureName)
  expect(trace).toMatchObject({
    pointCount: occupiedSize,
    massCount: occupiedSize,
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
  await openStateGridWorkflow(page, 'parameters-toggle')
  await page.getByTestId('param-override-beta').fill('0.4')
  await page.getByTestId('inspector-workflow-back').click()
  await openStateGridWorkflow(page, 'state-grid-setup-toggle')
  await page.getByTestId('state-grid-x-min').fill('-30')
  await page.getByTestId('state-grid-x-max').fill('30')
  await page.getByTestId('state-grid-x-resolution').fill('24')
  await page.getByTestId('state-grid-y-min').fill('-30')
  await page.getByTestId('state-grid-y-max').fill('30')
  await page.getByTestId('state-grid-y-resolution').fill('24')
  await page.getByTestId('state-grid-z-min').fill('-5')
  await page.getByTestId('state-grid-z-max').fill('55')
  await page.getByTestId('state-grid-z-resolution').fill('24')
  await page.getByTestId('inspector-workflow-back').click()
  await openStateGridWorkflow(page, 'state-grid-transfer-toggle')
  await expect(page.getByTestId('state-grid-transfer-time-step')).toHaveValue('1')
  await expect(page.getByTestId('state-grid-transfer-integration-step')).toHaveValue('0.01')
  await expect(page.getByText(/sampled flow map/)).toBeVisible()
  const equilibriumCoordinate = Math.sqrt(0.4 * 27)
  await page
    .getByTestId('state-grid-transfer-starting-point-0')
    .fill(equilibriumCoordinate.toString())
  await page
    .getByTestId('state-grid-transfer-starting-point-1')
    .fill(equilibriumCoordinate.toString())
  await page.getByTestId('state-grid-transfer-starting-point-2').fill('27')
  await page.getByTestId('state-grid-transfer-samples-per-cell').fill('8')
  await page.getByTestId('state-grid-transfer-time-step').fill('0.25')
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
  await expect(page.getByTestId('invariant-measure-cover-size')).toHaveText(/\/ 13,824$/)
  await expect(page.getByTestId('invariant-measure-data-section')).toContainText(
    equilibriumCoordinate.toString()
  )
  await expect(page.getByTestId('invariant-measure-effective-support')).toContainText('cells')
  await expect(page.getByTestId('invariant-measure-convergence-status')).toContainText(
    /Converged|Iteration limit reached/
  )
})

test('State Grid reports advancing cover progress and cancels without a late result', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('Langford')

  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-object-menu').waitFor()
  await page.getByTestId('create-state-grid').click()
  await openStateGridWorkflow(page, 'state-grid-setup-toggle')
  await page.getByTestId('state-grid-x-resolution').fill('50')
  await page.getByTestId('state-grid-y-resolution').fill('50')
  await page.getByTestId('state-grid-z-min').fill('-1')
  await page.getByTestId('state-grid-z-max').fill('2')
  await page.getByTestId('state-grid-z-resolution').fill('50')
  await page.getByTestId('inspector-workflow-back').click()
  await openStateGridWorkflow(page, 'state-grid-transfer-toggle')
  await expect(page.getByTestId('state-grid-transfer-time-step')).toHaveValue('1')
  await expect(page.getByTestId('state-grid-transfer-integration-step')).toHaveValue('0.01')
  await page.getByTestId('state-grid-create-invariant-measure').click()

  const toolbar = page.getByTestId('toolbar')
  await expect(toolbar).toContainText('Invariant measure · Exploring cover')
  await expect(toolbar).toContainText('dynamics steps')
  const initialProgress = await toolbar.innerText()
  const initialMatch = initialProgress.match(/([\d,]+) cells explored/)
  expect(initialMatch).not.toBeNull()
  const initialCells = Number(initialMatch?.[1].replaceAll(',', ''))
  expect(initialCells).toBeGreaterThan(0)
  await expect
    .poll(async () => {
      const match = (await toolbar.innerText()).match(/([\d,]+) cells explored/)
      return Number(match?.[1].replaceAll(',', '') ?? 0)
    })
    .toBeGreaterThan(initialCells)

  await page.getByTestId('cancel-calculation').click()
  await expect(toolbar).toContainText('Ready')
  await expect(page.getByTestId('state-grid-create-invariant-measure')).toBeEnabled()
  await expect(
    page.getByRole('button', {
      name: 'Invariant_Measure_State_Grid_1 (invariant measure)',
      exact: true,
    })
  ).toHaveCount(0)
  await page.waitForTimeout(500)
  await expect(toolbar).toContainText('Ready')
  await expect(
    page.getByRole('button', {
      name: 'Invariant_Measure_State_Grid_1 (invariant measure)',
      exact: true,
    })
  ).toHaveCount(0)
})
