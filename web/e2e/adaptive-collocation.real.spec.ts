import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

const systemName = 'Adaptive_Collocation_E2E'
const branchName = 'adaptive_cycle_branch'

async function selectAdaptationReport(page: Page) {
  const harness = createHarness(page)
  if (!(await page.getByTestId('workspace').isVisible())) {
    await harness.openSystem(systemName)
  }
  await harness.selectTreeNode(`Branch: ${branchName}`)
  await harness.openDisclosure('branch-summary-toggle')
  return page.getByTestId('collocation-adaptation-report')
}

test('persists a real-WASM adaptive collocation report and exact final mesh', async ({ page }) => {
  test.setTimeout(150_000)
  const harness = createHarness(page)

  // Browser persistence is intentional: the reload below verifies that the
  // worker/WASM report and final nonuniform mesh survive serialization.
  await harness.goto({ deterministic: false, mock: false })
  await harness.createSystem(systemName)

  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-param-0').fill('mu')
  await page.getByTestId('system-param-value-0').fill('1')
  await page.getByTestId('system-eq-0').fill('x*(mu-x^2-y^2)-y')
  await page.getByTestId('system-eq-1').fill('y*(mu-x^2-y^2)+x')
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await page.getByTestId('close-system-settings').click()

  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await page.getByTestId('action-orbit-run-toggle').click()
  await page.getByTestId('orbit-run-duration').fill('20')
  await page.getByTestId('orbit-run-dt').fill('0.02')
  await page.getByTestId('orbit-run-ic-0').fill('1')
  await page.getByTestId('orbit-run-ic-1').fill('0')
  await page.getByTestId('orbit-run-submit').click()

  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-limit-cycle-toggle').click()
  await page.getByTestId('limit-cycle-from-orbit-name').fill('adaptive_cycle')
  await page.getByTestId('limit-cycle-from-orbit-branch-name').fill(branchName)
  await page.getByTestId('limit-cycle-from-orbit-parameter').selectOption('mu')
  await page.getByTestId('limit-cycle-from-orbit-tolerance').fill('0.05')
  await page.getByTestId('limit-cycle-from-orbit-ntst').fill('4')
  await page.getByTestId('limit-cycle-from-orbit-ncol').fill('2')
  await page.getByTestId('limit-cycle-from-orbit-step-size').fill('0.002')
  await page.getByTestId('limit-cycle-from-orbit-max-steps').fill('2')
  await page.getByTestId('limit-cycle-from-orbit-min-step-size').fill('1e-7')
  await page.getByTestId('limit-cycle-from-orbit-max-step-size').fill('0.004')
  await page.getByTestId('limit-cycle-from-orbit-corrector-steps').fill('14')
  await page.getByTestId('limit-cycle-from-orbit-corrector-tolerance').fill('1e-10')
  await page.getByTestId('limit-cycle-from-orbit-step-tolerance').fill('1e-10')
  await page.getByTestId('limit-cycle-from-orbit-adaptive-defect-tolerance').fill('0.02')
  await page.getByTestId('limit-cycle-from-orbit-adaptive-max-refinements').fill('5')
  await page.getByTestId('limit-cycle-from-orbit-adaptive-max-mesh-points').fill('96')
  await page.getByTestId('limit-cycle-from-orbit-submit').click()

  await expect(
    page.getByRole('button', { name: new RegExp(`Branch: ${branchName}`, 'i') })
  ).toBeVisible({ timeout: 40_000 })
  const report = await selectAdaptationReport(page)
  await expect(report).toContainText('Defect tolerance')
  await expect(report).toContainText('2.0000e-2')
  await expect(report).toContainText(/Mesh intervals\s*4 → (?:[5-9]|\d{2,})/)
  await expect(report).toContainText(/Adaptations\s*[1-9]\d*/)
  await expect(report).toContainText('Attempt 1')

  await page.reload()
  const persistedReport = await selectAdaptationReport(page)
  await expect(persistedReport).toContainText('2.0000e-2')
  await expect(persistedReport).toContainText(/Mesh intervals\s*4 → (?:[5-9]|\d{2,})/)
  await expect(persistedReport).toContainText('Attempt 1')
})
