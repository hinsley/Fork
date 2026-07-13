import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

const PLOTLY_CDN_URL = 'https://cdn.plot.ly/plotly-2.32.0.min.js'
const MATHJAX_CDN_URL = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js'

function bundledPlotPayload(html: string): {
  viewports: Array<{
    figure: { data: Array<{ type?: string }> }
    fallbackImage?: string
  }>
} {
  const match = html.match(/<script id="plot-data"[^>]*>([^<]+)<\/script>/)
  if (!match?.[1]) throw new Error('Bundled plot payload is missing')
  return JSON.parse(gunzipSync(Buffer.from(match[1], 'base64')).toString('utf8'))
}

test('builder downloads a standalone stacked Plotly HTML page', async ({ page }) => {
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
  const publisherUrl = `http://localhost:${port}/Demo_System_embed.html`
  const harness = createHarness(page)
  await harness.goto({ fixture: 'demo' })
  await harness.openSystem('Demo_System')
  await page.getByTestId('viewport-insert-empty').click()
  await page.getByTestId('viewport-create-scene').click()
  await page.getByRole('button', { name: 'Add viewport' }).click()
  await page.getByTestId('viewport-create-bifurcation').click()

  await page.getByTestId('open-systems').click()
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('button', { name: 'Create embed' }).click()
  await expect(page.getByTestId('embed-dialog')).toBeVisible()
  await expect(page.getByTestId('embed-source')).toHaveValue('./Demo_System_embed.html')
  await expect(page.getByTestId('embed-code')).toHaveValue(/<iframe/)
  await expect(page.getByTestId('embed-code')).not.toHaveValue(/fork-embed/)

  const viewportChecks = page.locator('.embed-dialog__viewport-list input[type="checkbox"]')
  await expect(viewportChecks).toHaveCount(2)
  for (let index = 0; index < 2; index += 1) {
    await viewportChecks.nth(index).check()
  }
  await page.getByLabel('Theme').selectOption('dark')
  await page.getByLabel('Viewport headers').selectOption('show')

  const downloadButton = page.getByTestId('download-embed-html')
  await expect(downloadButton).toBeEnabled({ timeout: 15_000 })
  await expect(page.getByText('Ready to download.')).toHaveCount(0)
  const downloadPromise = page.waitForEvent('download')
  await downloadButton.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Demo_System_embed.html')
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const html = await readFile(downloadPath!, 'utf8')

  expect(html).toContain(PLOTLY_CDN_URL)
  expect(html).toContain(MATHJAX_CDN_URL)
  expect(html).toContain('window.Plotly.newPlot')
  expect(html).toContain('Scene_1')
  expect(html).toContain('Bifurcation_Diagram_1')
  expect(html).not.toContain('fork-embed')
  expect(html).not.toContain('forkdynamics.com')
  expect(html).not.toContain('manifest.json')
  expect(html).not.toContain('fork_wasm')

  const plotlyBundle = await readFile(
    new URL('../node_modules/plotly.js-dist-min/plotly.min.js', import.meta.url)
  )
  const mathJaxBundle = await readFile(
    new URL('../node_modules/mathjax/es5/tex-svg.js', import.meta.url)
  )
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.route(PLOTLY_CDN_URL, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: plotlyBundle })
  )
  await page.route(MATHJAX_CDN_URL, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: mathJaxBundle })
  )
  await page.route(publisherUrl, (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )

  await page.goto(publisherUrl)
  await expect(page.locator('.plot-card')).toHaveCount(2)
  await expect(page.locator('.js-plotly-plot')).toHaveCount(2, { timeout: 15_000 })
  await expect(page.locator('.plot-header')).toHaveCount(2)
  await expect(page.locator('.modebar')).toHaveCount(2)
  await expect(page.locator('#error')).toBeHidden()

  expect(requests.some((url) => url.includes('/embed/v1.js'))).toBe(false)
  expect(requests.some((url) => url.endsWith('/embed'))).toBe(false)
  expect(requests.some((url) => url.endsWith('.zip'))).toBe(false)
  expect(requests.some((url) => url.includes('fork_wasm'))).toBe(false)
})

test('generated static presentation disables Plotly interaction', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ fixture: 'demo' })
  await harness.openSystem('Demo_System')
  await page.getByTestId('viewport-insert-empty').click()
  await page.getByTestId('viewport-create-scene').click()
  await page.getByTestId('open-systems').click()
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('button', { name: 'Create embed' }).click()
  await page.getByLabel('Interaction').selectOption('none')

  const downloadButton = page.getByTestId('download-embed-html')
  await expect(downloadButton).toBeEnabled({ timeout: 15_000 })
  const downloadPromise = page.waitForEvent('download')
  await downloadButton.click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  const html = await readFile(downloadPath!, 'utf8')

  expect(html).toContain('"interaction":"none"')
  expect(html).toContain("staticPlot: payload.interaction === 'none'")
  expect(html).toContain("displayModeBar: payload.interaction === 'plot'")
})

test('bundled export renders under restrictive CSP without network dependencies', async ({
  page,
}) => {
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
  const publisherUrl = `http://localhost:${port}/Bundled_Demo_embed.html`
  const harness = createHarness(page)
  await harness.goto({ fixture: 'demo' })
  await harness.openSystem('Demo_System')
  await page.getByTestId('viewport-insert-empty').click()
  await page.getByTestId('viewport-create-scene').click()
  await page.getByTestId('open-systems').click()
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('button', { name: 'Create embed' }).click()
  await page.getByRole('checkbox', {
    name: 'Bundle dependencies (Experimental)',
  }).check()

  const downloadButton = page.getByTestId('download-embed-html')
  await expect(downloadButton).toBeEnabled({ timeout: 15_000 })
  const downloadPromise = page.waitForEvent('download')
  await downloadButton.click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const html = await readFile(downloadPath!, 'utf8')

  expect(html).not.toContain(PLOTLY_CDN_URL)
  expect(html).not.toContain(MATHJAX_CDN_URL)
  expect(html).toContain('id="bundled-dependencies"')
  expect(html).toContain("new DecompressionStream('gzip')")
  expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(5 * 1024 * 1024)
  const dependencyMatch = html.match(
    /<script id="bundled-dependencies"[^>]*>([^<]+)<\/script>/
  )
  expect(dependencyMatch?.[1]).toBeTruthy()
  const dependencyPackage = JSON.parse(
    gunzipSync(Buffer.from(dependencyMatch![1], 'base64')).toString('utf8')
  ) as { plotlyLicense: string; mathJaxLicense: string }
  expect(dependencyPackage.plotlyLicense).toContain('MIT License')
  expect(dependencyPackage.mathJaxLicense).toContain('Apache License')

  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.route(publisherUrl, (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: {
        'Content-Security-Policy': [
          "default-src 'none'",
          "script-src 'unsafe-inline'",
          "style-src 'unsafe-inline'",
          'img-src data: blob:',
          'font-src data:',
          "connect-src 'none'",
          'worker-src blob:',
        ].join('; '),
      },
      body: html,
    })
  )

  await page.goto(publisherUrl)
  await expect(page.locator('.plot-card')).toHaveCount(1)
  await expect(page.locator('.js-plotly-plot')).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator('.modebar')).toHaveCount(1)
  await expect(page.locator('#error')).toBeHidden()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Boolean(
            (window as typeof window & { MathJax?: { version?: string } }).MathJax?.version
          )
      )
    )
    .toBe(true)
  expect(requests).toEqual([publisherUrl])
})

test('bundled 3D export falls back to its captured camera without WebGL', async ({ page }) => {
  test.setTimeout(60_000)
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
  const publisherUrl = `http://localhost:${port}/Lorenz_embed.html`
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })
  await harness.openSystem('Lorenz')
  await harness.createScene()
  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await harness.runOrbit()

  await page.getByTestId('open-systems').click()
  await page
    .locator('.dialog__list-row')
    .filter({ has: page.getByRole('button', { name: 'Lorenz', exact: true }) })
    .getByRole('button', { name: 'Export' })
    .click()
  await page.getByRole('button', { name: 'Create embed' }).click()
  await page.getByRole('checkbox', {
    name: 'Bundle dependencies (Experimental)',
  }).check()

  const downloadButton = page.getByTestId('download-embed-html')
  await expect(downloadButton).toBeEnabled({ timeout: 20_000 })
  const downloadPromise = page.waitForEvent('download')
  await downloadButton.click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const html = await readFile(downloadPath!, 'utf8')
  const payload = bundledPlotPayload(html)
  expect(payload.viewports).toHaveLength(1)
  expect(payload.viewports[0]?.figure.data.some((trace) => trace.type === 'scatter3d')).toBe(
    true
  )
  expect(payload.viewports[0]?.fallbackImage).toMatch(/^data:image\/png;base64,/)

  await page.addInitScript({
    content: `
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
          return null;
        }
        return originalGetContext.call(this, type, ...args);
      };
    `,
  })
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.route(publisherUrl, (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: {
        'Content-Security-Policy': [
          "default-src 'none'",
          "script-src 'unsafe-inline'",
          "style-src 'unsafe-inline'",
          'img-src data:',
          'font-src data:',
          "connect-src 'none'",
          'worker-src blob:',
        ].join('; '),
      },
      body: html,
    })
  )

  await page.goto(publisherUrl)
  const fallback = page.locator('.plot-fallback-image')
  await expect(fallback).toHaveCount(1, { timeout: 15_000 })
  await expect(fallback).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect(page.locator('.js-plotly-plot')).toHaveCount(0)
  await expect(page.locator('#error')).toBeHidden()
  await expect(page.getByText(/WebGL is not supported/)).toHaveCount(0)
  expect(requests).toEqual([publisherUrl])
})
