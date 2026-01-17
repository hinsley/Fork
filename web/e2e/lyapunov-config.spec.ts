import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('lyapunov inputs persist after compute', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('Lyapunov_Drafts')
  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await harness.runOrbit()

  await expect(page.getByText('No orbit samples stored yet.')).toHaveCount(0)

  await page.getByTestId('oseledets-toggle').click()

  const lyapunovTransient = page.getByTestId('lyapunov-transient')
  const lyapunovQr = page.getByTestId('lyapunov-qr')
  const clvTransient = page.getByTestId('clv-transient')
  const clvForward = page.getByTestId('clv-forward')
  const clvBackward = page.getByTestId('clv-backward')
  const clvQr = page.getByTestId('clv-qr')

  await lyapunovTransient.fill('12')
  await lyapunovQr.fill('5')
  await clvTransient.fill('3')
  await clvForward.fill('4')
  await clvBackward.fill('6')
  await clvQr.fill('7')

  await page.getByTestId('lyapunov-submit').click()
  await expect(page.getByText('Lyapunov exponents not computed yet.')).toHaveCount(0)

  await expect(lyapunovTransient).toHaveValue('12')
  await expect(lyapunovQr).toHaveValue('5')
  await expect(clvTransient).toHaveValue('3')
  await expect(clvForward).toHaveValue('4')
  await expect(clvBackward).toHaveValue('6')
  await expect(clvQr).toHaveValue('7')

  await page.getByTestId('clv-submit').click()
  await expect(page.getByText('Covariant Lyapunov vectors not computed yet.')).toHaveCount(0)

  await expect(lyapunovTransient).toHaveValue('12')
  await expect(lyapunovQr).toHaveValue('5')
  await expect(clvTransient).toHaveValue('3')
  await expect(clvForward).toHaveValue('4')
  await expect(clvBackward).toHaveValue('6')
  await expect(clvQr).toHaveValue('7')
})

test('clv plotting menu appears only after computation', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('CLV_Plot_Gate')
  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await harness.runOrbit()

  await expect(page.getByText('No orbit samples stored yet.')).toHaveCount(0)

  await page.getByTestId('oseledets-toggle').click()
  await expect(page.getByTestId('clv-plot-toggle')).toHaveCount(0)

  await page.getByTestId('clv-submit').click()
  await expect(page.getByText('Covariant Lyapunov vectors not computed yet.')).toHaveCount(0)
  await expect(page.getByTestId('clv-plot-toggle')).toHaveCount(1)
})
