import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('inspector action bar and overflow menu use dark theme surfaces', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: false, mock: true })

  await page.getByTestId('open-settings').click()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await harness.openSystem('Lorenz')
  await harness.createOrbit()
  await harness.runOrbit()

  const resolveColors = () =>
    page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement)
      const resolveColor = (variable: string) => {
        const probe = document.createElement('div')
        probe.style.color = rootStyle.getPropertyValue(variable)
        document.body.append(probe)
        const color = getComputedStyle(probe).color
        probe.remove()
        return color
      }
      return {
        accent: resolveColor('--accent'),
        hover: resolveColor('--button-bg-hover'),
        text: resolveColor('--text'),
      }
    })
  const expected = await resolveColors()

  // The first primary action is a filled accent button.
  const primary = page.getByTestId('action-orbit-run-toggle')
  await expect(primary).toBeVisible()
  await expect(primary).toHaveClass(/btn--primary/)
  await expect
    .poll(() => primary.evaluate((button) => getComputedStyle(button).backgroundColor))
    .toBe(expected.accent)

  // Secondary actions live in the ⋯ menu with transparent rows and a hover surface.
  const more = page.getByTestId('inspector-actions-more')
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  const action = page.getByTestId('inspector-actions-menu').getByRole('menuitem').first()
  await expect(action).toBeVisible()

  const colors = await action.evaluate((button) => {
    const style = getComputedStyle(button)
    return { background: style.backgroundColor, text: style.color }
  })
  expect(colors.background).toBe('rgba(0, 0, 0, 0)')
  expect(colors.text).toBe(expected.text)

  await action.hover()
  await expect
    .poll(() => action.evaluate((button) => getComputedStyle(button).backgroundColor))
    .toBe(expected.hover)

  await page.keyboard.press('Escape')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(action).toBeHidden()
})
