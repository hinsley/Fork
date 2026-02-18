import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

type PlotlyTraceLike = {
  uid?: string
  name?: string
  customdata?: unknown
}

type PlotlyGraphDiv = HTMLElement & {
  data?: PlotlyTraceLike[]
  emit?: (event: string, payload: { points: Array<{ data?: PlotlyTraceLike; pointNumber?: number }> }) => void
}

test('clicking a scene orbit point jumps Orbit Data preview to the matching row', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.openSystem('Lorenz')
  await harness.createScene()

  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await harness.runOrbit()

  await harness.openDisclosure('orbit-data-toggle')
  await expect(page.getByText(/Selected point #/)).toHaveCount(0)

  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
      | PlotlyGraphDiv
      | null
    if (!node || typeof node.emit !== 'function') return false
    const trace = node.data?.find((entry) => entry?.name === 'Orbit_1')
    return Boolean(trace && typeof trace.uid === 'string')
  })

  const targetPointIndex = 17
  await page.evaluate((pointNumber) => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
      | PlotlyGraphDiv
      | null
    if (!node) throw new Error('Plotly viewport not found')
    const trace = node.data?.find((entry) => entry?.name === 'Orbit_1')
    if (!trace || typeof trace.uid !== 'string') {
      throw new Error('Orbit trace uid not found')
    }
    if (typeof node.emit !== 'function') throw new Error('Plotly emit missing')
    node.emit('plotly_click', {
      points: [{ data: { uid: trace.uid }, pointNumber }],
    })
  }, targetPointIndex)

  await expect(page.getByText(`Selected point #${targetPointIndex}`)).toBeVisible()
  await expect(page.getByText(/^Page 2 of \d+$/)).toBeVisible()
  await page.waitForFunction((selectedPointIndex) => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
      | PlotlyGraphDiv
      | null
    const selectedTrace = node?.data?.find((entry) => entry?.name === 'Orbit_1 selected point')
    if (!selectedTrace) return false
    if (!Array.isArray(selectedTrace.customdata)) return false
    return selectedTrace.customdata.includes(selectedPointIndex)
  }, targetPointIndex)
  const selectedRow = page.locator('.orbit-preview__table-grid tbody tr.is-selected')
  await expect(selectedRow).toHaveCount(1)
  await expect(selectedRow.locator('td').first()).toHaveText(String(targetPointIndex))

  await page.getByTestId('orbit-preview-next').click()
  await expect(page.getByText(/^Page 3 of \d+$/)).toBeVisible()
  await expect(selectedRow).toHaveCount(0)
})
