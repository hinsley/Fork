import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test.use({ viewport: { width: 1024, height: 800 } })

// Regression: in a tall, narrow tile the default 3D camera clipped the cube's
// tick labels and axis titles at the sides. The scene now keeps a square
// domain there, inset so the cube leaves room for its labels.
test('3D scene in a narrow tile keeps a square scene domain', async ({ page }) => {
  test.setTimeout(60_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('Lorenz')
  await harness.createScene()
  // Plotly only builds the gl3d scene once a 3D trace exists.
  await harness.createOrbit()
  await harness.runOrbit()

  const plot = page.locator('[data-testid="viewport-workspace"] .js-plotly-plot').first()
  await expect(plot).toBeVisible()
  await expect
    .poll(() =>
      plot.evaluate((node) => {
        const full = (node as unknown as {
          _fullLayout?: {
            width: number
            height: number
            scene?: { domain?: { x: number[]; y: number[] }; aspectmode?: string }
          }
        })._fullLayout
        const domain = full?.scene?.domain
        if (!full || !domain) return null
        const width = (domain.x[1] - domain.x[0]) * full.width
        const height = (domain.y[1] - domain.y[0]) * full.height
        return {
          tall: full.height > full.width,
          squareEnough: height <= width + 12,
          inset: domain.y[1] - domain.y[0] < 1,
          aspectmode: full.scene?.aspectmode ?? null,
        }
      })
    )
    .toEqual({ tall: true, squareEnough: true, inset: true, aspectmode: 'cube' })
})
