import { expect, test, type Locator, type Page } from '@playwright/test'
import { createHarness } from './harness'

test.describe.configure({ mode: 'serial' })

type AxisSetup = {
  name: string
  min: number
  max: number
  resolution: number
  seed: number
}

async function configureCustomSystem(
  page: Page,
  type: 'flow' | 'map',
  equations: string[]
) {
  await page.getByTestId('open-system-settings').click()
  if (type === 'map') await page.getByTestId('system-type-map').click()
  for (let index = 2; index < equations.length; index += 1) {
    await page.getByTestId('system-add-variable').click()
  }
  const variables = ['x', 'y', 'z']
  for (let index = 0; index < equations.length; index += 1) {
    await page.getByTestId(`system-var-${index}`).fill(variables[index])
    await page.getByTestId(`system-eq-${index}`).fill(equations[index])
  }
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await page.getByTestId('close-system-settings').click()
}

async function plotHasTrace(plot: Locator, name: string): Promise<boolean> {
  return await plot.evaluate((element, traceName) => {
    const ownPlotElement = element as HTMLElement & { data?: Array<{ name?: string }> }
    const plotElement = ownPlotElement.data
      ? ownPlotElement
      : (element.querySelector('.js-plotly-plot') as typeof ownPlotElement | null)
    return Boolean(plotElement?.data?.some((trace) => trace.name === traceName))
  }, name)
}

async function readTraceMarkerAppearance(
  plot: Locator,
  name: string
): Promise<{
  colors: string[]
  symbols: string[]
  uid: string
  selectorValid: boolean
} | null> {
  return await plot.evaluate((element, traceName) => {
    type PlotTrace = {
      name?: string
      uid?: string
      marker?: {
        color?: string | string[]
        symbol?: string | string[]
      }
    }
    const ownPlotElement = element as HTMLElement & { data?: PlotTrace[] }
    const plotElement = ownPlotElement.data
      ? ownPlotElement
      : (element.querySelector('.js-plotly-plot') as typeof ownPlotElement | null)
    const trace = plotElement?.data?.find((candidate) => candidate.name === traceName)
    if (!trace?.marker) return null
    const uid = trace.uid ?? ''
    let selectorValid = true
    try {
      element.ownerDocument.querySelector(`.cb${uid}`)
    } catch {
      selectorValid = false
    }
    return {
      colors: Array.isArray(trace.marker.color)
        ? trace.marker.color
        : trace.marker.color
          ? [trace.marker.color]
          : [],
      symbols: Array.isArray(trace.marker.symbol)
        ? trace.marker.symbol
        : trace.marker.symbol
          ? [trace.marker.symbol]
          : [],
      uid,
      selectorValid,
    }
  }, name)
}

async function runEigenmodeCase(
  page: Page,
  options: {
    type: 'flow' | 'map'
    axes: AxisSetup[]
    timeStep?: number
    samplesPerCell?: number
  }
) {
  const harness = createHarness(page)
  await harness.createScene()
  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-object-menu').waitFor()
  await page.getByTestId('create-state-grid').click()
  await page.getByTestId('action-state-grid-setup-toggle').click()
  for (const axis of options.axes) {
    await page.getByTestId(`state-grid-${axis.name}-min`).fill(String(axis.min))
    await page.getByTestId(`state-grid-${axis.name}-max`).fill(String(axis.max))
    await page
      .getByTestId(`state-grid-${axis.name}-resolution`)
      .fill(String(axis.resolution))
  }
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-state-grid-transfer-toggle').click()
  for (const [index, axis] of options.axes.entries()) {
    await page
      .getByTestId(`state-grid-transfer-starting-point-${index}`)
      .fill(String(axis.seed))
  }
  await page
    .getByTestId('state-grid-transfer-samples-per-cell')
    .fill(String(options.samplesPerCell ?? 8))
  await page.getByTestId('state-grid-transfer-stationary-iterations').fill('5000')
  await page.getByTestId('state-grid-transfer-tolerance').fill('1e-7')
  if (options.type === 'flow') {
    await page
      .getByTestId('state-grid-transfer-time-step')
      .fill(String(options.timeStep ?? 0.25))
    await page.getByTestId('state-grid-transfer-integration-step').fill('0.01')
  }
  await page.getByTestId('state-grid-create-invariant-measure').click()

  const measureName = 'Invariant_Measure_State_Grid_1'
  await expect(page.getByTestId('inspector-name')).toHaveValue(measureName, {
    timeout: 60_000,
  })
  const appearanceColor = '#000000'
  await page.getByTestId('action-appearance-toggle').click()
  await page.getByTestId('inspector-color').fill(appearanceColor)
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-invariant-measure-data-toggle').click()
  await expect(page.getByTestId('invariant-measure-convergence-status')).toHaveText(
    'Converged'
  )
  const coverText = await page.getByTestId('invariant-measure-cover-size').innerText()
  const coverSize = Number(coverText.split('/')[0].trim().replaceAll(',', ''))
  expect(coverSize).toBeGreaterThan(3)

  await page.getByTestId('invariant-eigenmode-count').fill('3')
  await expect(page.getByTestId('invariant-eigenmode-compute')).toBeEnabled()
  await page.getByTestId('invariant-eigenmode-compute').click()
  await expect(page.getByTestId('invariant-eigenmode-subset')).toContainText('modes', {
    timeout: 60_000,
  })
  await expect(page.getByTestId('invariant-eigenmode-1')).toBeVisible()
  await expect(page.getByTestId('invariant-measure-spectrum-plot')).toBeVisible()
  await expect(page.getByTestId('invariant-eigenmode-view-controls')).toContainText(
    'right eigenvector describes density relaxation'
  )

  const modeModuli = await page
    .locator('[data-testid^="invariant-eigenmode-"]')
    .filter({ hasText: '|λ|' })
    .allTextContents()
  const parsedModuli = modeModuli.map((text) => {
    const match = text.match(/\|λ\|\s+([+\-\d.eE]+)/)
    return Number(match?.[1])
  })
  for (let index = 1; index < parsedModuli.length; index += 1) {
    expect(parsedModuli[index]).toBeLessThanOrEqual(parsedModuli[index - 1] + 1e-12)
  }

  const scenePlot = page.locator('[data-testid^="plotly-viewport-"]').first()
  const modeTraceName = `${measureName} mode 1 real`
  await expect.poll(
    () => plotHasTrace(scenePlot, modeTraceName),
    { timeout: 30_000 }
  ).toBe(true)
  const markerAppearance = await readTraceMarkerAppearance(scenePlot, modeTraceName)
  expect(markerAppearance?.colors.length).toBeGreaterThan(0)
  expect(
    markerAppearance?.colors.every((color) => color === appearanceColor)
  ).toBe(true)
  expect(markerAppearance?.symbols).toEqual(['diamond'])
  expect(markerAppearance?.uid).toMatch(/-eigenmode$/)
  expect(markerAppearance?.uid).not.toContain(':')
  expect(markerAppearance?.selectorValid).toBe(true)
  return { measureName, coverSize }
}

test('sparse eigenmodes run on a representative two-dimensional discrete map', async ({ page }) => {
  test.setTimeout(120_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('Henon')
  await runEigenmodeCase(page, {
    type: 'map',
    axes: [
      { name: 'x', min: -1.5, max: 1.5, resolution: 12, seed: 0 },
      { name: 'y', min: -0.5, max: 0.5, resolution: 10, seed: 0 },
    ],
  })
})

test('sparse eigenmodes run on a representative three-dimensional discrete map', async ({ page }) => {
  test.setTimeout(120_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('Coupled_Logistic_3D')
  await configureCustomSystem(page, 'map', [
    '3.7*x*(1-x)',
    '3.8*y*(1-y)',
    '3.9*z*(1-z)',
  ])
  await runEigenmodeCase(page, {
    type: 'map',
    axes: [
      { name: 'x', min: 0, max: 1, resolution: 7, seed: 0.5 },
      { name: 'y', min: 0, max: 1, resolution: 7, seed: 0.5 },
      { name: 'z', min: 0, max: 1, resolution: 7, seed: 0.5 },
    ],
  })
})

test('sparse eigenmodes run on a representative two-dimensional sampled flow', async ({ page }) => {
  test.setTimeout(120_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('Van_der_Pol_2D')
  await configureCustomSystem(page, 'flow', [
    'y',
    '(1-x^2)*y-x',
  ])
  await runEigenmodeCase(page, {
    type: 'flow',
    timeStep: 0.25,
    axes: [
      { name: 'x', min: -3, max: 3, resolution: 14, seed: 1 },
      { name: 'y', min: -3, max: 3, resolution: 14, seed: 0 },
    ],
  })
})

test('sparse eigenmodes run on a representative three-dimensional sampled flow', async ({ page }) => {
  test.setTimeout(120_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('Lorenz')
  const equilibriumCoordinate = Math.sqrt((8 / 3) * 27)
  await runEigenmodeCase(page, {
    type: 'flow',
    timeStep: 0.25,
    axes: [
      { name: 'x', min: -25, max: 25, resolution: 12, seed: equilibriumCoordinate },
      { name: 'y', min: -25, max: 25, resolution: 12, seed: equilibriumCoordinate },
      { name: 'z', min: 0, max: 50, resolution: 12, seed: 27 },
    ],
  })
})
