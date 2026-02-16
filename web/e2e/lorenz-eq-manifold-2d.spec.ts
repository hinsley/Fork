import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

async function readMetricValue(page: Page, label: string): Promise<string> {
  const row = page.locator('.inspector-metrics__row', {
    has: page.locator('.inspector-metrics__label', { hasText: new RegExp(`^${label}$`, 'i') }),
  })
  await expect(row.first()).toBeVisible()
  return (await row.first().locator('.inspector-metrics__value').innerText()).trim()
}

function parseNumericMetric(raw: string): number {
  const normalized = raw.replaceAll(',', '').trim()
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Metric value is not numeric: "${raw}"`)
  }
  return parsed
}

test('lorenz 2D stable manifold defaults produce nontrivial growth', async ({ page }) => {
  test.setTimeout(180_000)

  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('Lorenz')
  await harness.createScene()
  await harness.createEquilibrium()

  await expect(
    page.locator('[data-testid^="object-tree-node-"]').filter({ hasText: /Equilibrium_1/i })
  ).toBeVisible()
  await harness.selectTreeNode('Equilibrium_1')
  await harness.solveEquilibrium()
  await expect(page.getByText(/^Solved$/)).toBeVisible({ timeout: 20_000 })

  await harness.openDisclosure('equilibrium-manifold-toggle')
  await page.getByTestId('equilibrium-manifold-name').fill('lorenz_eqm2d_e2e')
  await page.getByTestId('equilibrium-manifold-mode').selectOption('surface_2d')
  await page.getByTestId('equilibrium-manifold2d-profile').selectOption('lorenz_global')
  await page.getByTestId('equilibrium-manifold2d-target-radius').fill('8')
  await page.getByTestId('equilibrium-manifold2d-target-arclength').fill('20')
  await page.getByTestId('equilibrium-manifold-caps-max-steps').fill('500')
  await page.getByTestId('equilibrium-manifold-caps-max-rings').fill('60')
  await page.getByTestId('equilibrium-manifold-caps-max-vertices').fill('100000')
  await page.getByTestId('equilibrium-manifold-caps-max-time').fill('50')
  await page.getByTestId('equilibrium-manifold-submit').click()

  const branchLabelPattern = /Branch:\s+lorenz_eqm2d_e2e\s+\(equilibrium manifold \(2d/i
  await expect(page.getByRole('button', { name: branchLabelPattern })).toBeVisible({
    timeout: 120_000,
  })

  await harness.selectTreeNode('Branch: lorenz_eqm2d_e2e')
  await harness.openDisclosure('branch-summary-toggle')

  const termination = await readMetricValue(page, 'Termination')
  expect(termination).not.toMatch(
    /ring build failed|ring spacing failed|ring quality rejected|geodesic quality rejected/i
  )

  const rings = parseNumericMetric(await readMetricValue(page, 'Surface rings'))
  const vertices = parseNumericMetric(await readMetricValue(page, 'Surface vertices'))
  const minLeafDeltaReached = await readMetricValue(page, 'Min leaf delta reached')

  expect(rings).toBeGreaterThanOrEqual(6)
  expect(vertices).toBeGreaterThanOrEqual(120)
  expect(minLeafDeltaReached.toLowerCase()).toBe('no')
})
