import { expect, test } from '@playwright/test'
import { buildSystemArchiveBytes } from '../src/system/archive'
import { createDemoSystem } from '../src/system/fixtures'
import { addScene } from '../src/system/model'
import { createHarness } from './harness'

test('embed builder exposes selected viewports and export markup', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ fixture: 'demo' })
  await harness.openSystem('Demo_System')
  await page.getByTestId('viewport-insert-empty').click()
  await page.getByTestId('viewport-create-scene').click()
  await page.getByTestId('open-systems').click()
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('button', { name: 'Create embed' }).click()
  await expect(page.getByTestId('embed-dialog')).toBeVisible()
  await expect(page.getByTestId('embed-source')).toHaveValue('./Demo_System.zip')
  await expect(page.getByTestId('embed-code')).toHaveValue(/forkdynamics\.com\/embed\/v1\.js/)
  await expect(page.getByTestId('embed-code')).toHaveValue(/viewports=/)

  await page.getByLabel('Theme').selectOption('dark')
  await page.getByLabel('Viewport headers').selectOption('show')
  const headerBackground = await page
    .locator('.embed-dialog__preview .viewport-tile__header')
    .evaluate((header) => getComputedStyle(header).backgroundColor)
  expect(headerBackground).toBe('rgb(19, 29, 40)')

  await expect(page.getByText('Reset view')).toHaveCount(0)
  await expect(page.getByText('Fullscreen')).toHaveCount(0)
  await expect(page.getByTestId('embed-code')).not.toHaveValue(/controls=/)
})

test('publisher-origin loader renders a ZIP without CORS headers', async ({ page }, testInfo) => {
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
  const publisherOrigin = `http://localhost:${port}`
  const viewerOrigin = `http://127.0.0.1:${port}`
  const base = createDemoSystem().system
  const scene = addScene(base, 'Embedded Scene')
  const system = scene.system
  const sceneId = scene.nodeId
  const archive = buildSystemArchiveBytes(system)

  await page.route(`${publisherOrigin}/system.zip`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/zip',
      body: Buffer.from(archive),
      headers: {},
    })
  })

  await page.goto(`${publisherOrigin}/?publisher=1`)
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <script defer src="${viewerOrigin}/embed/v1.js"></script>
        <fork-embed
          src="/system.zip"
          viewports="${sceneId}"
          controls="reset fullscreen"
          style="display:block;width:800px;height:520px"
        ></fork-embed>
      </body>
    </html>
  `)

  const frame = page.frameLocator('fork-embed iframe')
  await expect(frame.getByTestId('embed-viewer')).toBeVisible({ timeout: 15_000 })
  await expect(frame.locator('[data-testid^="plotly-viewport-"]')).toBeVisible()
  await expect(frame.getByTestId('toolbar')).toHaveCount(0)
  await expect(frame.getByTestId('objects-panel')).toHaveCount(0)
  await expect(frame.getByText('Reset view')).toHaveCount(0)
  await expect(frame.getByText('Fullscreen')).toHaveCount(0)

  await testInfo.attach('embed-origins', {
    body: `${publisherOrigin} -> ${viewerOrigin}`,
    contentType: 'text/plain',
  })
})
