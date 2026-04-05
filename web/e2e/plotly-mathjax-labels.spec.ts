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

test('plotly renders MathJax 3D analysis labels through annotation fallback', async ({ page }) => {
  test.setTimeout(60_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.openSystem('Lorenz')
  await harness.createOrbit()
  await harness.runOrbit()
  await page.getByTestId('viewport-insert-empty').click()
  await page.getByTestId('viewport-create-analysis').click()
  await page.locator('[data-testid^="viewport-header-"]').first().click()

  const viewport = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect(viewport).toBeVisible()

  await page.getByLabel('Axis value').nth(2).selectOption('observable')
  await page.getByTestId('analysis-axis-expression-z').fill('z')
  const labels = page.getByLabel('Label')
  await labels.nth(0).fill('\\(x\\)')
  await labels.nth(1).fill('$y$')
  await labels.nth(2).fill('value \\(z_{n+1}\\)')

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
          | (HTMLElement & {
              _fullLayout?: {
                scene?: {
                  annotations?: Array<{ text?: string }>
                  xaxis?: { title?: { text?: string } }
                  yaxis?: { title?: { text?: string } }
                  zaxis?: { title?: { text?: string } }
                }
              }
            })
          | null
        const scene = node?._fullLayout?.scene
        return JSON.stringify({
          annotationTexts: Array.isArray(scene?.annotations)
            ? scene.annotations.map((annotation) => annotation?.text)
            : [],
          titles: [
            scene?.xaxis?.title?.text ?? null,
            scene?.yaxis?.title?.text ?? null,
            scene?.zaxis?.title?.text ?? null,
          ],
          hasMathGroup: document.querySelectorAll('.annotation-text-math-group').length > 0,
        })
      })
    })
    .toBe(
      JSON.stringify({
        annotationTexts: ['\\(x\\)', '$y$', 'value \\(z_{n+1}\\)'],
        titles: ['', '', ''],
        hasMathGroup: true,
      })
    )

  await expect(viewport.locator('.annotation-text-math-group').first()).toBeVisible()
})
