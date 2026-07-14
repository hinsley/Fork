import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

const fixture = 'homoclinic-product'
const systemName = 'Homoclinic_Product_E2E'
const sourceBranchName = 'duffing_large_cycle'
const homoclinicBranchName = 'duffing_homoclinic_shooting'

async function expectSceneTrace(page: Page, traceName: string) {
  await expect
    .poll(
      () =>
        page.evaluate((name) => {
          const nodes = Array.from(
            document.querySelectorAll('[data-testid^="plotly-viewport-"]')
          ) as Array<HTMLElement & { data?: Array<{ name?: string }> }>
          return nodes.some((node) => node.data?.some((trace) => trace.name === name))
        }, traceName),
      { timeout: 15_000 }
    )
    .toBe(true)
}

async function selectHomoclinicEvent(page: Page, label: RegExp) {
  const harness = createHarness(page)
  await harness.openDisclosure('branch-points-toggle')
  const event = page.locator('[data-testid^="branch-bifurcation-"]').filter({ hasText: label })
  await expect(event.first()).toBeVisible()
  await event.first().click()
  await page.getByTestId('branch-point-details-toggle').click()
  return page.getByTestId('homoclinic-event-diagnostics')
}

async function reopenFixtureBranch(page: Page) {
  const harness = createHarness(page)
  await harness.openSystem(systemName)
  await harness.selectTreeNode(`Branch: ${homoclinicBranchName}`)
  await expect(page.getByText(/homoclinic curve · \d+ points?/i)).toBeVisible()
  await expectSceneTrace(page, homoclinicBranchName)
}

test('creates, renders, reloads, and extends a homoclinic branch with HBK diagnostics', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const harness = createHarness(page)

  // This browser fixture is intentionally deterministic. The analytic Duffing
  // continuation itself remains covered by the real Node-WASM smoke test.
  await harness.goto({ deterministic: false, mock: true, fixture })
  await harness.openSystem(systemName)
  await harness.selectTreeNode(`Branch: ${sourceBranchName}`)
  await harness.openDisclosure('branch-points-toggle')
  await page.getByTestId('branch-point-input').fill('0')
  await page.getByTestId('branch-point-jump').click()

  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-homoclinic-from-large-cycle-toggle').click()
  await page.getByTestId('homoclinic-from-large-cycle-name').fill(homoclinicBranchName)
  await page.getByTestId('homoclinic-from-large-cycle-param1').selectOption('mu')
  await page.getByTestId('homoclinic-from-large-cycle-param2').selectOption('nu')
  await page.getByTestId('homoclinic-from-large-cycle-method').selectOption('shooting')
  await expect(
    page.getByTestId('homoclinic-from-large-cycle-shooting-intervals')
  ).toBeVisible()
  await expect(
    page.getByTestId('homoclinic-from-large-cycle-integration-steps-per-segment')
  ).toBeVisible()
  await expect(
    page.getByTestId('homoclinic-from-large-cycle-adaptive-collocation-enabled')
  ).toHaveCount(0)
  await page.getByTestId('homoclinic-from-large-cycle-shooting-intervals').fill('4')
  await page
    .getByTestId('homoclinic-from-large-cycle-integration-steps-per-segment')
    .fill('32')
  await page.getByTestId('homoclinic-from-large-cycle-max-steps').fill('3')
  await page.getByTestId('homoclinic-from-large-cycle-submit').click()

  await expect(
    page.getByRole('button', { name: new RegExp(`Branch: ${homoclinicBranchName}`, 'i') })
  ).toBeVisible()
  await expect(page.getByText(/homoclinic curve · 1 point/i)).toBeVisible()
  await expectSceneTrace(page, homoclinicBranchName)

  const initialDiagnostics = await selectHomoclinicEvent(page, /NNS - Neutral Saddle/i)
  await expect(initialDiagnostics).toContainText('NNS · Neutral saddle')
  await expect(initialDiagnostics).toContainText('available · value -1.250000e-1')
  await expect(initialDiagnostics).toContainText(
    'IFU · Inclination flip (unstable manifold)'
  )
  await expect(initialDiagnostics).toContainText(
    'unsupported · value unavailable · reason adjoint continuation is unavailable'
  )

  await page.reload()
  await reopenFixtureBranch(page)
  const reloadedDiagnostics = await selectHomoclinicEvent(page, /NNS - Neutral Saddle/i)
  await expect(reloadedDiagnostics).toContainText('NNS · Neutral saddle')

  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-branch-extend-toggle').click()
  await page.getByTestId('branch-extend-max-steps').fill('2')
  await page.getByTestId('branch-extend-step-size').fill('0.002')
  await page.getByTestId('branch-extend-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await expect(page.getByText(/homoclinic curve · 2 points/i)).toBeVisible()

  const extendedDiagnostics = await selectHomoclinicEvent(
    page,
    /NSF - Neutral Saddle-Focus/i
  )
  await expect(extendedDiagnostics).toContainText('NSF · Neutral saddle-focus')
  await expect(extendedDiagnostics).toContainText('available · value 3.125000e-2')
  await expect(extendedDiagnostics).toContainText('IFS · Inclination flip (stable manifold)')

  await page.reload()
  await reopenFixtureBranch(page)
  await expect(page.getByText(/homoclinic curve · 2 points/i)).toBeVisible()
  const persistedExtension = await selectHomoclinicEvent(
    page,
    /NSF - Neutral Saddle-Focus/i
  )
  await expect(persistedExtension).toContainText('NSF · Neutral saddle-focus')
})
