import { test } from '@playwright/test'
import { createHarness } from './harness'

type PlotlyTrace = {
  name?: string
  mode?: string
}

type PlotlyGraphDiv = HTMLElement & {
  data?: PlotlyTrace[]
}

test('branch point navigation previews limit cycles in state space', async ({ page }) => {
  test.setTimeout(60_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true, fixture: 'pd' })

  await harness.openSystem('Period Doubling Fixture')
  await harness.createScene()

  await harness.selectTreeNode('Branch: lc_pd_mu')
  await page.getByTestId('branch-points-toggle').click()

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
