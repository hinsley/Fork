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
  markerOpacities: number[]
  sizes: number[]
  symbols: string[]
  traceOpacity: number
  traceType: string
  uid: string
  selectorValid: boolean
} | null> {
  return await plot.evaluate((element, traceName) => {
    type PlotTrace = {
      name?: string
      uid?: string
      opacity?: number
      type?: string
      marker?: {
        color?: string | string[]
        opacity?: number | number[]
        size?: number | number[]
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
      markerOpacities: Array.isArray(trace.marker.opacity)
        ? trace.marker.opacity
        : typeof trace.marker.opacity === 'number'
          ? [trace.marker.opacity]
          : [],
      sizes: Array.isArray(trace.marker.size)
        ? trace.marker.size
        : typeof trace.marker.size === 'number'
          ? [trace.marker.size]
          : [],
      symbols: Array.isArray(trace.marker.symbol)
        ? trace.marker.symbol
        : trace.marker.symbol
          ? [trace.marker.symbol]
          : [],
      traceOpacity: trace.opacity ?? 1,
      traceType: trace.type ?? '',
      uid,
      selectorValid,
    }
  }, name)
}

function markerOpacitySignature(appearance: {
  colors: string[]
  markerOpacities: number[]
}): number[] {
  if (appearance.markerOpacities.length > 0) return appearance.markerOpacities
  return appearance.colors.map((color) => {
    if (color === '#000000') return 1
    const match = color.match(/rgba\(0, 0, 0, ([\d.]+)\)/)
    return Number(match?.[1] ?? 1)
  })
}

async function createAdditionalStateSpaceScene(page: Page) {
  const plots = page.locator('[data-testid^="plotly-viewport-"]')
  await expect(plots).toHaveCount(1)
  const firstPlot = plots.first()
  const testId = await firstPlot.getAttribute('data-testid')
  const sceneId = testId?.replace('plotly-viewport-', '')
  if (!sceneId) throw new Error('The first State Space scene has no test identifier.')
  await page.getByTestId(`viewport-insert-${sceneId}`).click()
  await page.getByTestId('viewport-create-scene').click()
  await expect(plots).toHaveCount(2)
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
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const harness = createHarness(page)
  await harness.createScene()
  await createAdditionalStateSpaceScene(page)
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
  await page.getByTestId('inspector-color-opacity').fill('80')
  await page.getByTestId('inspector-point-size').fill('7')
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

  const scenePlots = await page.locator('[data-testid^="plotly-viewport-"]').all()
  expect(scenePlots).toHaveLength(2)
  const modeTraceName = `${measureName} mode 1 real`
  for (const scenePlot of scenePlots) {
    await expect.poll(
      () => plotHasTrace(scenePlot, modeTraceName),
      { timeout: 30_000 }
    ).toBe(true)
    const stationaryAppearance = await readTraceMarkerAppearance(scenePlot, measureName)
    const modeAppearance = await readTraceMarkerAppearance(scenePlot, modeTraceName)
    expect(stationaryAppearance).not.toBeNull()
    expect(modeAppearance).not.toBeNull()
    expect(modeAppearance?.traceType).toBe(stationaryAppearance?.traceType)
    expect(modeAppearance?.sizes).toEqual(stationaryAppearance?.sizes)
    expect(modeAppearance?.sizes).toEqual([7])
    expect(modeAppearance?.symbols).toEqual(stationaryAppearance?.symbols)
    expect(modeAppearance?.symbols).toEqual([])
    expect(modeAppearance?.traceOpacity).toBe(stationaryAppearance?.traceOpacity)
    expect(modeAppearance?.traceOpacity).toBeCloseTo(0.8)
    expect(
      modeAppearance?.colors.every(
        (color) => color === appearanceColor || color.startsWith('rgba(0, 0, 0, ')
      )
    ).toBe(true)
    const stationaryOpacities = markerOpacitySignature(stationaryAppearance!)
    const modeOpacities = markerOpacitySignature(modeAppearance!)
    expect(new Set(modeOpacities).size).toBeGreaterThan(1)
    expect(modeOpacities).not.toEqual(stationaryOpacities)
    expect(modeAppearance?.uid).toMatch(/^eigenmode-/)
    expect(modeAppearance?.uid).not.toContain(':')
    expect(modeAppearance?.selectorValid).toBe(true)
  }

  const updatedPointSize = 11
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-appearance-toggle').click()
  await page.getByTestId('inspector-point-size').fill(String(updatedPointSize))
  for (const scenePlot of scenePlots) {
    await expect.poll(async () => {
      const stationaryAppearance = await readTraceMarkerAppearance(scenePlot, measureName)
      const modeAppearance = await readTraceMarkerAppearance(scenePlot, modeTraceName)
      return {
        stationary: stationaryAppearance?.sizes ?? [],
        mode: modeAppearance?.sizes ?? [],
      }
    }, { timeout: 30_000 }).toEqual({
      stationary: [updatedPointSize],
      mode: [updatedPointSize],
    })
  }
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-invariant-measure-data-toggle').click()

  await page.getByTestId('invariant-eigenmode-hide').click()
  for (const scenePlot of scenePlots) {
    await expect.poll(
      () => plotHasTrace(scenePlot, modeTraceName),
      { timeout: 30_000 }
    ).toBe(false)
  }
  await expect(page.locator('.plotly-viewport__overlay.is-error')).toHaveCount(0)

  await page.getByTestId('invariant-eigenmode-1').click()
  await expect(page.getByTestId('invariant-eigenmode-hide')).toBeVisible()
  for (const scenePlot of scenePlots) {
    await expect.poll(
      () => plotHasTrace(scenePlot, modeTraceName),
      { timeout: 30_000 }
    ).toBe(true)
  }
  expect(
    pageErrors.filter(
      (message) => message.includes('querySelector') || message.includes('not a valid selector')
    )
  ).toEqual([])
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
