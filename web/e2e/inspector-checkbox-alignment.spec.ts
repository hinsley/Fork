import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('plain inspector checkbox labels align without changing multi-column control rows', async ({
  page,
}) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('Lorenz')
  await harness.createEquilibrium()
  await harness.solveEquilibrium()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-equilibrium-data-toggle').click()
  await harness.openDisclosure('equilibrium-data-eigenpairs-toggle')

  const plainCheckbox = page.getByTestId('equilibrium-eigenvector-enabled')
  const plainLabel = plainCheckbox.locator('..')

  await expect(plainLabel).toHaveCSS('display', 'flex')
  await expect(plainLabel).toHaveCSS('align-items', 'center')
  await expect(plainLabel).toHaveCSS('justify-content', 'flex-start')
  await expect(plainCheckbox).toHaveCSS('order', '-1')

  const plainCheckboxBox = await plainCheckbox.boundingBox()
  const plainLabelBox = await plainLabel.boundingBox()
  expect(plainCheckboxBox).not.toBeNull()
  expect(plainLabelBox).not.toBeNull()
  expect(plainCheckboxBox!.width).toBeLessThan(plainLabelBox!.width / 2)
  expect(plainCheckboxBox!.x).toBeLessThan(plainLabelBox!.x + 24)

  const specializedRow = page.locator('.clv-control-row').first()
  await expect(specializedRow).toHaveCSS('display', 'grid')
  await expect(specializedRow).toHaveCSS('align-items', 'center')

  const opacityInput = specializedRow.locator('.opacity-percent-input')
  await expect(opacityInput).toHaveCount(1)
  expect(
    await opacityInput.evaluate((input) => input.nextElementSibling === null)
  ).toBe(true)
})
