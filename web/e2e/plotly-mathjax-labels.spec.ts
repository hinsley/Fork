import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

test.describe.configure({ mode: 'serial' })

async function setupAnalysisViewport(page: Page) {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })
  await harness.openSystem('Lorenz')
  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await page.getByTestId('orbit-run-toggle').waitFor({ state: 'visible' })
  await harness.runOrbit()
  await page.getByTestId('viewport-insert-empty').waitFor({ state: 'visible' })
  await page.getByTestId('viewport-insert-empty').click()
  await page.getByTestId('viewport-create-analysis').click()
  await page.locator('[data-testid^="viewport-header-"]').first().click()
}

test('plotly normalizes mixed MathJax labels for 2D analysis axes', async ({ page }) => {
  test.setTimeout(60_000)

  await setupAnalysisViewport(page)

  const viewport = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect(viewport).toBeVisible()

  const labels = page.getByLabel('Label')
  await labels.nth(0).fill('$x_1^2$+2')
  await labels.nth(1).fill('value \\(y\\)')

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
          | (HTMLElement & {
              _fullLayout?: {
                xaxis?: { title?: { text?: string } }
                yaxis?: { title?: { text?: string } }
              }
            })
          | null
        return JSON.stringify({
          xTitle: node?._fullLayout?.xaxis?.title?.text ?? null,
          yTitle: node?._fullLayout?.yaxis?.title?.text ?? null,
          hasXMathGroup: document.querySelectorAll('.xtitle-math-group').length > 0,
          hasYMathGroup: document.querySelectorAll('.ytitle-math-group').length > 0,
        })
      })
    })
    .toBe(
      JSON.stringify({
        xTitle: '$x_1^2+2$',
        yTitle: '$\\text{value }y$',
        hasXMathGroup: true,
        hasYMathGroup: true,
      })
    )
})

test('plotly renders newly introduced MathJax glyphs on incremental label updates', async ({
  page,
}) => {
  test.setTimeout(60_000)

  await setupAnalysisViewport(page)

  const viewport = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect(viewport).toBeVisible()

  const labels = page.getByLabel('Label')
  await labels.nth(0).fill('$x$')
  await labels.nth(0).fill('$q$')

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
          | (HTMLElement & {
              _fullLayout?: {
                xaxis?: { title?: { text?: string } }
              }
            })
          | null
        const svg = node?.querySelector('.xtitle-math-group svg')
        return JSON.stringify({
          title: node?._fullLayout?.xaxis?.title?.text ?? null,
          hasMathGroup: Boolean(node?.querySelector('.xtitle-math-group')),
          hasLocalDefs: Boolean(svg?.querySelector('defs')),
          usesQGlyph: svg?.outerHTML.includes('1D45E') ?? false,
        })
      })
    })
    .toBe(
      JSON.stringify({
        title: '$q$',
        hasMathGroup: true,
        hasLocalDefs: true,
        usesQGlyph: true,
      })
    )
})

test('plotly renders normalized mixed MathJax labels through 3D annotation fallback', async ({
  page,
}) => {
  test.setTimeout(60_000)

  await setupAnalysisViewport(page)

  const viewport = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect(viewport).toBeVisible()

  await page.getByLabel('Axis value').nth(2).selectOption('observable')
  await page.getByTestId('analysis-axis-expression-z').fill('z')
  const labels = page.getByLabel('Label')
  await labels.nth(0).fill('\\(x\\)')
  await labels.nth(1).fill('$y$')
  await labels.nth(2).fill('$z_{n+1}$+2')

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
        annotationTexts: ['\\(x\\)', '$y$', '$z_{n+1}+2$'],
        titles: ['', '', ''],
        hasMathGroup: true,
      })
    )

  await expect(viewport.locator('.annotation-text-math-group').first()).toBeVisible()
})
