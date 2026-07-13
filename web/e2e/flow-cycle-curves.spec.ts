import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

type CycleCurveFixture = {
  systemName: string
  mu: string
  beta: string
  transverseEquations: [string, string]
  bifurcationLabel: RegExp
  curveName: string
  curveDetail: RegExp
}

async function configureCycleSystem(page: Page, fixture: CycleCurveFixture) {
  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-add-variable').click()
  await page.getByTestId('system-add-variable').click()
  await page.getByTestId('system-var-2').fill('u')
  await page.getByTestId('system-var-3').fill('v')
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-param-0').fill('mu')
  await page.getByTestId('system-param-value-0').fill(fixture.mu)
  await page.getByTestId('system-param-1').fill('beta')
  await page.getByTestId('system-param-value-1').fill(fixture.beta)
  await page.getByTestId('system-eq-0').fill('-y+x*(1-x^2-y^2)')
  await page.getByTestId('system-eq-1').fill('x+y*(1-x^2-y^2)')
  await page.getByTestId('system-eq-2').fill(fixture.transverseEquations[0])
  await page.getByTestId('system-eq-3').fill(fixture.transverseEquations[1])
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await expect(page.locator('[data-testid^="system-eq-error-"]')).toHaveCount(0)
  await page.getByTestId('close-system-settings').click()
}

async function createCrossingLimitCycle(page: Page, branchName: string) {
  const harness = createHarness(page)
  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await page.getByTestId('action-orbit-run-toggle').click()
  await page.getByTestId('orbit-run-duration').fill('20')
  await page.getByTestId('orbit-run-dt').fill('0.02')
  await page.getByTestId('orbit-run-ic-0').fill('1')
  await page.getByTestId('orbit-run-ic-1').fill('0')
  await page.getByTestId('orbit-run-ic-2').fill('0')
  await page.getByTestId('orbit-run-ic-3').fill('0')
  await page.getByTestId('orbit-run-submit').click()

  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-limit-cycle-toggle').click()
  await page.getByTestId('limit-cycle-from-orbit-name').fill(`${branchName}_object`)
  await page.getByTestId('limit-cycle-from-orbit-branch-name').fill(branchName)
  await page.getByTestId('limit-cycle-from-orbit-parameter').selectOption('mu')
  await page.getByTestId('limit-cycle-from-orbit-tolerance').fill('0.05')
  await page.getByTestId('limit-cycle-from-orbit-ntst').fill('8')
  await page.getByTestId('limit-cycle-from-orbit-ncol').fill('3')
  await page.getByTestId('limit-cycle-from-orbit-step-size').fill('0.004')
  await page.getByTestId('limit-cycle-from-orbit-max-steps').fill('12')
  await page.getByTestId('limit-cycle-from-orbit-min-step-size').fill('1e-6')
  await page.getByTestId('limit-cycle-from-orbit-max-step-size').fill('0.008')
  await page.getByTestId('limit-cycle-from-orbit-corrector-steps').fill('12')
  await page.getByTestId('limit-cycle-from-orbit-corrector-tolerance').fill('1e-9')
  await page.getByTestId('limit-cycle-from-orbit-step-tolerance').fill('1e-10')
  await page.getByTestId('limit-cycle-from-orbit-submit').click()
}

async function continueDetectedCycleCurve(page: Page, fixture: CycleCurveFixture) {
  const harness = createHarness(page)
  const sourceLabel = `Branch: ${fixture.curveName}_source`
  await expect(page.getByRole('button', { name: new RegExp(sourceLabel, 'i') })).toBeVisible({
    timeout: 40_000,
  })
  await harness.selectTreeNode(sourceLabel)
  await harness.openDisclosure('branch-points-toggle')
  const bifurcation = page
    .locator('[data-testid^="branch-bifurcation-"]')
    .filter({ hasText: fixture.bifurcationLabel })
    .first()
  await expect(bifurcation).toBeVisible({ timeout: 40_000 })
  await bifurcation.click()
  await page.getByTestId('inspector-workflow-back').click()
  await page.getByTestId('action-limit-cycle-codim1-curve-toggle').click()

  await page.getByTestId('limit-cycle-codim1-curve-name').fill(fixture.curveName)
  await page.getByTestId('limit-cycle-codim1-curve-param2').selectOption('beta')
  await page.getByTestId('limit-cycle-codim1-curve-step-size').fill('0.002')
  await page.getByTestId('limit-cycle-codim1-curve-max-steps').fill('6')
  await page.getByTestId('limit-cycle-codim1-curve-min-step-size').fill('1e-7')
  await page.getByTestId('limit-cycle-codim1-curve-max-step-size').fill('0.005')
  await page.getByTestId('limit-cycle-codim1-curve-corrector-steps').fill('12')
  await page.getByTestId('limit-cycle-codim1-curve-corrector-tolerance').fill('1e-9')
  await page.getByTestId('limit-cycle-codim1-curve-step-tolerance').fill('1e-10')
  await page.getByTestId('limit-cycle-codim1-curve-submit').click()

  const curveLabel = `Branch: ${fixture.curveName}`
  await expect(page.getByRole('button', { name: new RegExp(curveLabel, 'i') })).toBeVisible({
    timeout: 40_000,
  })
  await harness.selectTreeNode(curveLabel)
  await expect(page.getByText(fixture.curveDetail)).toBeVisible()
}

const pdFixture: CycleCurveFixture = {
  systemName: 'Flow_PD_Curve_E2E',
  mu: '0.04',
  beta: '0.25',
  transverseEquations: [
    '((mu-beta^2-0.2)/2+(mu-beta^2+0.2)*x/2)*u+((mu-beta^2+0.2)*y/2-0.5)*v',
    '((mu-beta^2+0.2)*y/2+0.5)*u+((mu-beta^2-0.2)/2-(mu-beta^2+0.2)*x/2)*v',
  ],
  bifurcationLabel: /Period Doubling/i,
  curveName: 'pd_cycle_curve',
  curveDetail: /pd curve · (?:[2-9]|\d{2,}) points/i,
}

const nsFixture: CycleCurveFixture = {
  systemName: 'Flow_NS_Curve_E2E',
  mu: '0.07',
  beta: '0.3',
  transverseEquations: [
    '(mu-beta^2)*u-(0.2+0.1*beta)*v-(u^2+v^2)*u',
    '(0.2+0.1*beta)*u+(mu-beta^2)*v-(u^2+v^2)*v',
  ],
  bifurcationLabel: /Neimark[- ]Sacker/i,
  curveName: 'ns_cycle_curve',
  curveDetail: /ns curve · (?:[2-9]|\d{2,}) points/i,
}

for (const fixture of [pdFixture, nsFixture]) {
  test(`continues a detected ${fixture.curveName.startsWith('pd') ? 'PD' : 'NS'} cycle curve`, async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const harness = createHarness(page)
    await harness.goto({ deterministic: true, mock: false })
    await harness.createSystem(fixture.systemName)
    await configureCycleSystem(page, fixture)
    await createCrossingLimitCycle(page, `${fixture.curveName}_source`)
    await continueDetectedCycleCurve(page, fixture)
  })
}
