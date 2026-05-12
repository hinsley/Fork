import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createHarness } from './harness'

test('data systems attach local CSV files and render streamed PSD results', async ({
  page,
}, testInfo) => {
  const csvPath = testInfo.outputPath('fork-psd-signal.csv')
  const rows = ['signal']
  for (let index = 0; index < 256; index += 1) {
    rows.push(
      String(
        Math.sin(2 * Math.PI * 0.125 * index) +
          0.25 * Math.sin(2 * Math.PI * 0.25 * index)
      )
    )
  }
  await writeFile(csvPath, rows.join('\n'))

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })

  await page.getByTestId('open-systems-empty').click()
  await page.getByTestId('system-name-input').fill('Data_PSD_System')
  await page.getByTestId('system-type-input').selectOption('data')
  await page.getByTestId('create-system').click()
  await page.getByTestId('workspace').waitFor()

  await page.getByTestId('open-system-settings').click()
  await expect(page.getByTestId('system-settings-dialog')).toBeVisible()
  await expect(page.getByTestId('system-type')).toHaveValue('data')
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
})
