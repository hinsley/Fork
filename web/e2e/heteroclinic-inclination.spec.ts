import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

const fixtures = [
  {
    slug: 'sif',
    wEquation: 'x*w+(mu-nu)*(1-x^2)+mu*(1-x^2)*y',
    yEquation: '0.5*y',
    zEquation: '-3*z',
    marker: 'HeteroclinicSourceInclinationFlip',
    diagnostic: 'SIF · Source inclination flip',
  },
  {
    slug: 'tif',
    wEquation: 'x*w-(mu-nu)*(1-x^2)-mu*(1-x^2)*y',
    yEquation: '-0.5*y',
    zEquation: '3*z',
    marker: 'HeteroclinicTargetInclinationFlip',
    diagnostic: 'TIF · Target inclination flip',
  },
] as const

async function configureSystem(page: Page, fixture: (typeof fixtures)[number]) {
  await page.getByTestId('open-system-settings').click()
  await page.getByTestId('system-add-variable').click()
  await page.getByTestId('system-add-variable').click()
  await page.getByTestId('system-var-0').fill('x')
  await page.getByTestId('system-var-1').fill('w')
  await page.getByTestId('system-var-2').fill('y')
  await page.getByTestId('system-var-3').fill('z')
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId('system-param-0').fill('mu')
  await page.getByTestId('system-param-value-0').fill('-0.003')
  await page.getByTestId('system-param-1').fill('nu')
  await page.getByTestId('system-param-value-1').fill('-0.003')
  await page.getByTestId('system-eq-0').fill('1-x^2')
  await page.getByTestId('system-eq-1').fill(fixture.wEquation)
  await page.getByTestId('system-eq-2').fill(fixture.yEquation)
  await page.getByTestId('system-eq-3').fill(fixture.zEquation)
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await expect(page.getByTestId('system-errors')).toHaveCount(0)
  await page.getByTestId('close-system-settings').click()
}

async function createSeedObjects(page: Page, harness: ReturnType<typeof createHarness>) {
  await harness.createOrbit()
  await page.getByTestId('inspector-name').fill('ConnectionOrbit')
  await page.getByTestId('inspector-name').press('Enter')
  await page.getByTestId('action-orbit-run-toggle').click()
  await page.getByTestId('orbit-run-ic-0').fill('-0.9999092042625951')
  for (let index = 1; index < 4; index += 1) {
    await page.getByTestId(`orbit-run-ic-${index}`).fill('0')
  }
  await page.getByTestId('orbit-run-duration').fill('10')
  await page.getByTestId('orbit-run-dt').fill('0.05')
  await page.getByTestId('orbit-run-submit').click()
  await page.getByTestId('inspector-workflow-back').click()

  for (const [name, x] of [
    ['SourceEq', '-1'],
    ['TargetEq', '1'],
  ] as const) {
    await harness.createEquilibrium()
    await page.getByTestId('inspector-name').fill(name)
    await page.getByTestId('inspector-name').press('Enter')
    await page.getByTestId('action-equilibrium-solver-toggle').click()
    await page.getByTestId('equilibrium-solve-guess-0').fill(x)
    for (let index = 1; index < 4; index += 1) {
      await page.getByTestId(`equilibrium-solve-guess-${index}`).fill('0')
    }
    await page.getByTestId('equilibrium-solve-submit').click()
    await page.getByTestId('inspector-workflow-back').click()
    await expect(page.getByText(/^Solved$/)).toBeVisible()
  }
}

for (const fixture of fixtures) {
  test(`${fixture.slug.toUpperCase()} is localized, reloaded, and extended through real WASM`, async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const harness = createHarness(page)
    const systemName = `Heteroclinic_${fixture.slug.toUpperCase()}_E2E`
    const branchName = `${fixture.slug}_connection`
    const branchLabel = `Branch: ${branchName}`

    await harness.goto({ deterministic: false, mock: false })
    await harness.createSystem(systemName)
    await configureSystem(page, fixture)
    await createSeedObjects(page, harness)

    await harness.selectTreeNode('ConnectionOrbit')
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
    await page.getByTestId('heteroclinic-max-steps').fill('8')
    await page.getByTestId('heteroclinic-min-step-size').fill('1e-7')
    await page.getByTestId('heteroclinic-max-step-size').fill('0.001')
    await page.getByTestId('heteroclinic-corrector-steps').fill('24')
    await page.getByTestId('heteroclinic-corrector-tolerance').fill('1e-9')
    await page.getByTestId('heteroclinic-step-tolerance').fill('1e-9')
    await page.getByTestId('heteroclinic-from-orbit-submit').click()

    await expect(page.getByRole('button', { name: new RegExp(branchLabel, 'i') })).toBeVisible({
      timeout: 60_000,
    })
    await harness.selectTreeNode(branchLabel)
    const branchSummary = page.getByText(/heteroclinic curve · \d+ points/i)
    await expect(branchSummary).toBeVisible()
    const count = Number((await branchSummary.textContent())?.match(/(\d+) points/i)?.[1])
    expect(count).toBeGreaterThan(8)

    await harness.openDisclosure('branch-points-toggle')
    await page.getByTestId('branch-point-details-toggle').click()
    const inspector = page.getByTestId('inspector-panel-body')
    let markerIndex = -1
    for (let index = 0; index < count; index += 1) {
      await page.getByTestId('branch-point-input').fill(String(index))
      await page.getByTestId('branch-point-jump').click()
      if ((await inspector.textContent())?.includes(fixture.marker)) {
        markerIndex = index
        break
      }
    }
    expect(markerIndex).toBeGreaterThanOrEqual(0)
    const diagnostics = page.getByTestId('heteroclinic-event-diagnostics')
    await expect(diagnostics).toContainText(fixture.diagnostic)
    await expect(diagnostics).toContainText('available')
    await expect(diagnostics).toContainText(/inclination transport/i)

    await page.reload()
    await harness.openSystem(systemName)
    await harness.selectTreeNode(branchLabel)
    await expect(page.getByText(new RegExp(`heteroclinic curve · ${count} points`, 'i'))).toBeVisible()
    await page.getByTestId('action-branch-extend-toggle').click()
    await page.getByTestId('branch-extend-max-steps').fill('1')
    await page.getByTestId('branch-extend-step-size').fill('0.001')
    await page.getByTestId('branch-extend-submit').click()
    await page.getByTestId('inspector-workflow-back').click()
    await expect(page.getByText(new RegExp(`heteroclinic curve · ${count + 1} points`, 'i'))).toBeVisible({
      timeout: 60_000,
    })
  })
}
