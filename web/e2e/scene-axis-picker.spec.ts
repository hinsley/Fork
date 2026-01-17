import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('scene axis picker is per scene for high-dimensional systems', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true, fixture: 'axis-picker' })
  await harness.openSystem('Axis_Picker_Fixture')

  await page
    .locator('[data-testid^="viewport-header-"]')
    .filter({ hasText: /Scene A/i })
    .first()
    .click()

  const axisX = page.getByTestId('scene-axis-x')
  const axisY = page.getByTestId('scene-axis-y')
  const axisZ = page.getByTestId('scene-axis-z')

  await expect(axisX).toHaveValue('x')
  await expect(axisY).toHaveValue('y')
  await expect(axisZ).toHaveValue('z')

  await axisX.selectOption('w')
  await axisY.selectOption('x')
  await axisZ.selectOption('y')

  await expect(axisX).toHaveValue('w')
  await expect(axisY).toHaveValue('x')
  await expect(axisZ).toHaveValue('y')

  await page
    .locator('[data-testid^="viewport-header-"]')
    .filter({ hasText: /Scene B/i })
    .first()
    .click()

  await expect(page.getByTestId('scene-axis-x')).toHaveValue('x')
  await expect(page.getByTestId('scene-axis-y')).toHaveValue('y')
  await expect(page.getByTestId('scene-axis-z')).toHaveValue('z')

  await page
    .locator('[data-testid^="viewport-header-"]')
    .filter({ hasText: /Scene A/i })
    .first()
    .click()

  await expect(page.getByTestId('scene-axis-x')).toHaveValue('w')
  await expect(page.getByTestId('scene-axis-y')).toHaveValue('x')
  await expect(page.getByTestId('scene-axis-z')).toHaveValue('y')
})

test('scene axis picker hides for systems with fewer than four variables', async ({
  page,
}) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true, fixture: 'demo' })
  await harness.openSystem('Demo_System')

  await harness.createScene()
  await page.locator('[data-testid^="viewport-header-"]').first().click()

  await expect(page.getByTestId('scene-axis-x')).toHaveCount(0)
  await expect(page.getByTestId('scene-axis-y')).toHaveCount(0)
  await expect(page.getByTestId('scene-axis-z')).toHaveCount(0)
})
