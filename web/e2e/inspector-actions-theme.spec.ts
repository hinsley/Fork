import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('inspector Action rows use dark theme button surfaces', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: false, mock: true })

  await page.getByTestId('open-settings').click()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await harness.openSystem('Lorenz')
  await harness.createOrbit()

  const action = page.locator('.inspector-action-row').first()
  await expect(action).toBeVisible()

  const colors = await action.evaluate((button) => {
    const rootStyle = getComputedStyle(document.documentElement)
    const resolveColor = (variable: string) => {
      const probe = document.createElement('div')
      probe.style.color = rootStyle.getPropertyValue(variable)
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }
    const style = getComputedStyle(button)
    return {
      background: style.backgroundColor,
      border: style.borderTopColor,
      text: style.color,
      expectedBackground: resolveColor('--button-bg'),
      expectedHover: resolveColor('--button-bg-hover'),
      expectedBorder: resolveColor('--panel-border'),
      expectedText: resolveColor('--text'),
    }
  })

  expect(colors.background).toBe(colors.expectedBackground)
  expect(colors.border).toBe(colors.expectedBorder)
  expect(colors.text).toBe(colors.expectedText)

  await action.hover()
  await expect
    .poll(() => action.evaluate((button) => getComputedStyle(button).backgroundColor))
    .toBe(colors.expectedHover)
})
