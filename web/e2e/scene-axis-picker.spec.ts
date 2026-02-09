import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('scene axis picker and axis count are per scene for high-dimensional systems', async ({
  page,
}) => {
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
  const axisCount = page.getByTestId('scene-axis-count')

  await expect(axisCount).toHaveValue('3')
  await expect(axisX).toHaveValue('x')
  await expect(axisY).toHaveValue('y')
  await expect(axisZ).toHaveValue('z')

  await axisCount.selectOption('2')
  await expect(axisZ).toHaveCount(0)
  await expect(axisX).toHaveValue('x')
  await expect(axisY).toHaveValue('y')

  await axisX.selectOption('w')
  await axisY.selectOption('x')

  await expect(axisX).toHaveValue('w')
  await expect(axisY).toHaveValue('x')
  await expect(axisZ).toHaveCount(0)

  await page
    .locator('[data-testid^="viewport-header-"]')
    .filter({ hasText: /Scene B/i })
    .first()
    .click()

  await expect(page.getByTestId('scene-axis-count')).toHaveValue('3')
  await expect(page.getByTestId('scene-axis-x')).toHaveValue('x')
  await expect(page.getByTestId('scene-axis-y')).toHaveValue('y')
  await expect(page.getByTestId('scene-axis-z')).toHaveValue('z')

  await page.getByTestId('scene-axis-count').selectOption('1')
  await expect(page.getByTestId('scene-axis-x')).toHaveValue('x')
  await expect(page.getByTestId('scene-axis-y')).toHaveCount(0)
  await expect(page.getByTestId('scene-axis-z')).toHaveCount(0)

  await page
    .locator('[data-testid^="viewport-header-"]')
    .filter({ hasText: /Scene A/i })
    .first()
    .click()

  await expect(page.getByTestId('scene-axis-count')).toHaveValue('2')
  await expect(page.getByTestId('scene-axis-x')).toHaveValue('w')
  await expect(page.getByTestId('scene-axis-y')).toHaveValue('x')
  await expect(page.getByTestId('scene-axis-z')).toHaveCount(0)
})

test('scene axis picker is available for 2D systems', async ({
  page,
}) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true, fixture: 'demo' })
  await harness.openSystem('Demo_System')

  await harness.createScene()
  await page.locator('[data-testid^="viewport-header-"]').first().click()

  await expect(page.getByTestId('scene-axis-count')).toHaveValue('2')
  await expect(page.getByTestId('scene-axis-x')).toHaveValue('x')
  await expect(page.getByTestId('scene-axis-y')).toHaveValue('y')
  await expect(page.getByTestId('scene-axis-z')).toHaveCount(0)

  await page.getByTestId('scene-axis-count').selectOption('1')
  await expect(page.getByTestId('scene-axis-x')).toHaveValue('x')
  await expect(page.getByTestId('scene-axis-y')).toHaveCount(0)
})

test('scene axis picker supports 1D map mode controls in high-dimensional maps', async ({
  page,
}) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true, fixture: 'axis-picker-map' })
  await harness.openSystem('Axis_Picker_Map_Fixture')

  await page
    .locator('[data-testid^="viewport-header-"]')
    .filter({ hasText: /Map Scene A/i })
    .first()
    .click()

  await expect(page.getByTestId('scene-axis-count')).toHaveValue('3')
  await page.getByTestId('scene-axis-count').selectOption('1')
  await expect(page.getByTestId('scene-axis-x')).toHaveValue('x')
  await expect(page.getByTestId('scene-axis-y')).toHaveCount(0)
  await expect(page.getByTestId('scene-axis-z')).toHaveCount(0)
})
