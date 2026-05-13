import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createHarness } from './harness'

test('data systems attach local CSV files and render streamed paths and PSD results', async ({
  page,
}, testInfo) => {
  const csvPath = testInfo.outputPath('fork-psd-signal.csv')
  const rows = ['x,y']
  for (let index = 0; index < 256; index += 1) {
    const x = Math.sin(2 * Math.PI * index / 32)
    const y = Math.cos(2 * Math.PI * index / 32)
    rows.push(`${x},${y}`)
  }
  await writeFile(csvPath, rows.join('\n'))

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })

  await page.getByTestId('new-data-system-empty').click()
  await page.getByTestId('workspace').waitFor()
  await expect(page.getByTestId('system-settings-dialog')).toBeVisible()
  await expect(page.getByTestId('system-type')).toHaveValue('data')
  await expect(
    page.locator('[data-testid^="object-tree-node-"]').filter({ hasText: 'starter-signal' })
  ).toBeVisible()
  await expect(page.getByText('No datasets yet.')).toBeHidden()
  await page.getByTestId('close-system-settings').click()
  await expect(page.getByTestId('attach-data-button')).toBeVisible()

  await harness.selectTreeNode('starter-signal')
  const starterSummary = page.getByTestId('dataset-summary')
  await expect(starterSummary).toContainText('Source: starter-signal.csv')
  await expect(starterSummary).toContainText('Rows: 512')
  await expect(starterSummary).toContainText('Power Spectrum')
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
          | (HTMLElement & {
              _fullData?: Array<{ name?: string; type?: string; x?: number[]; y?: number[] }>
              _fullLayout?: {
                xaxis?: { title?: { text?: string } }
                yaxis?: { title?: { text?: string } }
              }
            })
          | null
        const trace = node?._fullData?.find((entry) => entry.name === 'starter-signal')
        return JSON.stringify({
          name: trace?.name ?? null,
          type: trace?.type ?? null,
          points: trace?.x?.length ?? 0,
          xTitle: node?._fullLayout?.xaxis?.title?.text ?? null,
          yTitle: node?._fullLayout?.yaxis?.title?.text ?? null,
        })
      })
    )
    .toBe(
      JSON.stringify({
        name: 'starter-signal',
        type: 'scattergl',
        points: 512,
        xTitle: 't',
        yTitle: 'signal',
      })
    )

  await page.getByTestId('attach-data-button').click()
  await page.getByTestId('data-csv-window-size').fill('64')
  await page.getByTestId('data-csv-file').setInputFiles(csvPath)
  await page.getByTestId('data-csv-attach').click()

  await page.getByTestId('close-system-settings').click()
  await harness.selectTreeNode('fork-psd-signal')

  const datasetSummary = page.getByTestId('dataset-summary')
  await expect(datasetSummary).toContainText('Source: fork-psd-signal.csv')
  await expect(datasetSummary).toContainText('Rows: 256')
  await expect(datasetSummary).toContainText('Power Spectrum')
  await expect(datasetSummary).toContainText('Segments: 4')
  await expect(datasetSummary).toContainText('Window: 64')

  const viewport = page.locator('[data-testid^="plotly-viewport-"]').first()
  await expect(viewport).toHaveAttribute('data-trace-count', /[1-9]/)
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const node = document.querySelector('[data-testid^="plotly-viewport-"]') as
          | (HTMLElement & {
              _fullData?: Array<{ name?: string; type?: string; x?: number[]; y?: number[] }>
              _fullLayout?: {
                xaxis?: { title?: { text?: string } }
                yaxis?: { title?: { text?: string } }
              }
            })
          | null
        const trace = node?._fullData?.find((entry) => entry.name === 'fork-psd-signal')
        return JSON.stringify({
          name: trace?.name ?? null,
          type: trace?.type ?? null,
          points: trace?.x?.length ?? 0,
          firstX: trace?.x?.[0] ?? null,
          firstY: trace?.y?.[0] ?? null,
          xTitle: node?._fullLayout?.xaxis?.title?.text ?? null,
          yTitle: node?._fullLayout?.yaxis?.title?.text ?? null,
        })
      })
    )
    .toBe(
      JSON.stringify({
        name: 'fork-psd-signal',
        type: 'scattergl',
        points: 256,
        firstX: 0,
        firstY: 1,
        xTitle: 'x',
        yTitle: 'y',
      })
    )
})
