import { test } from '@playwright/test'
import { createHarness } from './harness'

type PlotlyTrace = {
  name?: string
  mode?: string
  line?: { color?: string }
}

type PlotlyGraphDiv = HTMLElement & {
  data?: PlotlyTrace[]
}

test('branch point navigation previews limit cycles in state space', async ({ page }) => {
  test.setTimeout(60_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true, fixture: 'pd' })

  await harness.openSystem('Period_Doubling_Fixture')
  await harness.createScene()

  await harness.selectTreeNode('Branch: lc_pd_mu')
  await harness.openDisclosure('branch-points-toggle')

  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
      | PlotlyGraphDiv
      | null
    return Boolean(
      node?.data?.some(
        (trace) => trace?.name === 'LC Preview: lc_pd_mu @ 0' && trace?.mode === 'lines'
      )
    )
  })

  await page.getByTestId('branch-point-next').click()

  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
      | PlotlyGraphDiv
      | null
    return Boolean(
      node?.data?.some(
        (trace) => trace?.name === 'LC Preview: lc_pd_mu @ 1' && trace?.mode === 'lines'
      )
    )
  })
})

test('rendering a limit cycle persists after leaving branch selection', async ({ page }) => {
  test.setTimeout(60_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true, fixture: 'pd' })

  await harness.openSystem('Period_Doubling_Fixture')
  await harness.createScene()

  await harness.selectTreeNode('Branch: lc_pd_mu')
  await harness.openDisclosure('branch-points-toggle')
  await page.getByTestId('branch-point-render-lc').click()

  await harness.selectTreeNode('LC_PD (limit cycle)')

  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
      | PlotlyGraphDiv
      | null
    return Boolean(
      node?.data?.some(
        (trace) => trace?.name === 'LC_PD' && trace?.mode === 'lines'
      )
    )
  })
})

test('limit cycle rendering uses the limit cycle object color', async ({ page }) => {
  test.setTimeout(60_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true, fixture: 'pd' })

  await harness.openSystem('Period_Doubling_Fixture')
  await harness.createScene()

  await harness.selectTreeNode('Branch: lc_pd_mu')
  await harness.openDisclosure('branch-points-toggle')
  await page.getByTestId('branch-point-render-lc').click()
  await page.getByTestId('inspector-color').fill('#0000ff')

  await harness.selectTreeNode('LC_PD (limit cycle)')
  await page.getByTestId('inspector-color').fill('#ff0000')

  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
      | PlotlyGraphDiv
      | null
    return Boolean(
      node?.data?.some(
        (trace) => trace?.name === 'LC_PD' && trace?.line?.color === '#ff0000'
      )
    )
  })
})
