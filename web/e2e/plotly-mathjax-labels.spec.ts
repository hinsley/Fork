import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('plotly renders MathJax axis titles when labels use LaTeX delimiters', async ({ page }) => {
  test.setTimeout(60_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.openSystem('Lorenz')
  await harness.createScene()

  const viewport = page.locator('[data-testid^="plotly-viewport-"]').first()
  await page.waitForFunction(() =>
    document.querySelector('[data-testid^="plotly-viewport-"]')?.classList.contains('js-plotly-plot')
  )
  await expect(viewport).toBeVisible()

  const applied = await page.evaluate(async () => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]') as HTMLElement | null
    const Plotly = (window as unknown as {
      Plotly?: { relayout?: (target: HTMLElement, update: Record<string, unknown>) => Promise<void> }
    }).Plotly
    if (!node || !Plotly?.relayout) return false

    await Plotly.relayout(node, {
      'xaxis.title.text': '$x_1^2$',
    })
    return true
  })

  if (!applied) {
    throw new Error('Plotly.relayout was not available in the browser context.')
  }

  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid^="plotly-viewport-"]')
    return Boolean(node?.querySelector('.xtitle-math-group'))
  })

  await expect(viewport.locator('.xtitle-math-group').first()).toBeVisible()
})
