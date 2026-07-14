import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

const systemName = 'Heteroclinic_Product_E2E'
const branchName = 'heteroc_source_to_target'
const shootingBranchName = 'heteroc_source_to_target_shooting'

test('continues, reloads, and extends a real two-equilibrium heteroclinic curve', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const harness = createHarness(page)

  // Real browser persistence is required for the reload-and-extension leg.
  await harness.goto({ deterministic: false, mock: false })
  await harness.createSystem(systemName)

  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-param-0').fill('mu')
  await page.getByTestId('system-param-value-0').fill('0')
  await page.getByTestId('system-param-1').fill('nu')
  await page.getByTestId('system-param-value-1').fill('0')
  await page.getByTestId('system-eq-0').fill('1-x^2')
  await page.getByTestId('system-eq-1').fill('x*y+(mu-nu)*(1-x^2)')
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await page.getByTestId('close-system-settings').click()

  await harness.createOrbit()
  await page.getByTestId('inspector-name').fill('ConnectionOrbit')
  await page.getByTestId('inspector-name').press('Enter')
  await page.getByTestId('action-orbit-run-toggle').click()
  await page.getByTestId('orbit-run-ic-0').fill('-0.9999092042625951')
  await page.getByTestId('orbit-run-ic-1').fill('0')
  await page.getByTestId('orbit-run-duration').fill('10')
  await page.getByTestId('orbit-run-dt').fill('0.05')
  await page.getByTestId('orbit-run-submit').click()
  await page.getByTestId('inspector-workflow-back').click()

  await harness.createEquilibrium()
  await page.getByTestId('inspector-name').fill('SourceEq')
  await page.getByTestId('inspector-name').press('Enter')
  await page.getByTestId('action-equilibrium-solver-toggle').click()
  await page.getByTestId('equilibrium-solve-guess-0').fill('-1')
  await page.getByTestId('equilibrium-solve-guess-1').fill('0')
  await page.getByTestId('equilibrium-solve-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await expect(page.getByText(/^Solved$/)).toBeVisible()

  await harness.createEquilibrium()
  await page.getByTestId('inspector-name').fill('TargetEq')
  await page.getByTestId('inspector-name').press('Enter')
  await page.getByTestId('action-equilibrium-solver-toggle').click()
  await page.getByTestId('equilibrium-solve-guess-0').fill('1')
  await page.getByTestId('equilibrium-solve-guess-1').fill('0')
  await page.getByTestId('equilibrium-solve-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await expect(page.getByText(/^Solved$/)).toBeVisible()

  await harness.selectTreeNode('ConnectionOrbit')
  await expect(page.getByTestId('action-heteroclinic-from-orbit-toggle')).toBeVisible()
  await page.getByTestId('action-heteroclinic-from-orbit-toggle').click()
  await page.getByTestId('heteroclinic-from-orbit-name').fill(branchName)
  await page.getByTestId('heteroclinic-source-equilibrium').selectOption({ label: 'SourceEq' })
  await page.getByTestId('heteroclinic-target-equilibrium').selectOption({ label: 'TargetEq' })
  await page.getByTestId('heteroclinic-param1').selectOption('mu')
  await page.getByTestId('heteroclinic-param2').selectOption('nu')
  await page.getByTestId('heteroclinic-ntst').fill('20')
  await page.getByTestId('heteroclinic-ncol').fill('3')
  await page.getByRole('checkbox', { name: 'Free flight time T' }).check()
  await page.getByRole('checkbox', { name: 'Free source radius eps0' }).uncheck()
  await page.getByRole('checkbox', { name: 'Free target radius eps1' }).uncheck()
  await page.getByTestId('heteroclinic-step-size').fill('0.001')
  await page.getByTestId('heteroclinic-max-steps').fill('2')
  await page.getByTestId('heteroclinic-min-step-size').fill('1e-7')
  await page.getByTestId('heteroclinic-max-step-size').fill('0.002')
  await page.getByTestId('heteroclinic-corrector-steps').fill('24')
  await page.getByTestId('heteroclinic-corrector-tolerance').fill('1e-9')
  await page.getByTestId('heteroclinic-step-tolerance').fill('1e-9')
  await page.getByTestId('heteroclinic-from-orbit-submit').click()

  const branchLabel = `Branch: ${branchName}`
  await expect(page.getByRole('button', { name: new RegExp(branchLabel, 'i') })).toBeVisible({
    timeout: 45_000,
  })
  await harness.selectTreeNode(branchLabel)
  await expect(page.getByText(/heteroclinic curve · 3 points/i)).toBeVisible()
  await page.getByTestId('action-branch-summary-toggle').click()
  const inspector = page.getByTestId('inspector-panel-body')
  await expect(inspector.getByText('SourceEq', { exact: true })).toBeVisible()
  await expect(inspector.getByText('TargetEq', { exact: true })).toBeVisible()
  await expect(inspector.getByText('v1', { exact: true })).toBeVisible()
  await expect(inspector.getByText('20 x 3', { exact: true })).toBeVisible()

  await page.reload()
  await harness.openSystem(systemName)
  await harness.selectTreeNode(branchLabel)
  await expect(page.getByText(/heteroclinic curve · 3 points/i)).toBeVisible()

  await page.getByTestId('action-branch-extend-toggle').click()
  await page.getByTestId('branch-extend-max-steps').fill('1')
  await page.getByTestId('branch-extend-step-size').fill('0.001')
  await page.getByTestId('branch-extend-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await expect(page.getByText(/heteroclinic curve · 4 points/i)).toBeVisible({
    timeout: 45_000,
  })

  await harness.selectTreeNode('ConnectionOrbit')
  await page.getByTestId('action-heteroclinic-from-orbit-toggle').click()
  await page.getByTestId('heteroclinic-from-orbit-name').fill(shootingBranchName)
  await page.getByTestId('heteroclinic-source-equilibrium').selectOption({ label: 'SourceEq' })
  await page.getByTestId('heteroclinic-target-equilibrium').selectOption({ label: 'TargetEq' })
  await page.getByTestId('heteroclinic-param1').selectOption('mu')
  await page.getByTestId('heteroclinic-param2').selectOption('nu')
  await page.getByTestId('heteroclinic-method').selectOption('shooting')
  await page.getByTestId('heteroclinic-ntst').fill('20')
  await page.getByTestId('heteroclinic-ncol').fill('3')
  await page.getByTestId('heteroclinic-shooting-intervals').fill('6')
  await page.getByTestId('heteroclinic-integration-steps').fill('96')
  await page.getByRole('checkbox', { name: 'Free flight time T' }).check()
  await page.getByRole('checkbox', { name: 'Free source radius eps0' }).uncheck()
  await page.getByRole('checkbox', { name: 'Free target radius eps1' }).uncheck()
  await page.getByTestId('heteroclinic-step-size').fill('0.001')
  await page.getByTestId('heteroclinic-max-steps').fill('2')
  await page.getByTestId('heteroclinic-min-step-size').fill('1e-7')
  await page.getByTestId('heteroclinic-max-step-size').fill('0.002')
  await page.getByTestId('heteroclinic-corrector-steps').fill('24')
  await page.getByTestId('heteroclinic-corrector-tolerance').fill('1e-9')
  await page.getByTestId('heteroclinic-step-tolerance').fill('1e-9')
  await page.getByTestId('heteroclinic-from-orbit-submit').click()

  const shootingBranchLabel = `Branch: ${shootingBranchName}`
  await expect(page.getByRole('button', { name: new RegExp(shootingBranchLabel, 'i') })).toBeVisible({
    timeout: 45_000,
  })
  await harness.selectTreeNode(shootingBranchLabel)
  await expect(page.getByText(/heteroclinic curve · 3 points/i)).toBeVisible()
  await page.getByTestId('action-branch-summary-toggle').click()
  await expect(inspector.getByText('Multiple shooting', { exact: true })).toBeVisible()
  await expect(inspector.getByText('6', { exact: true })).toBeVisible()

  await page.reload()
  await harness.openSystem(systemName)
  await harness.selectTreeNode(shootingBranchLabel)
  await page.getByTestId('action-branch-extend-toggle').click()
  await page.getByTestId('branch-extend-max-steps').fill('1')
  await page.getByTestId('branch-extend-step-size').fill('0.001')
  await page.getByTestId('branch-extend-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await expect(page.getByText(/heteroclinic curve · 4 points/i)).toBeVisible({
    timeout: 45_000,
  })
})
