import { expect, test, type Page } from '@playwright/test'
import { createHarness } from './harness'

async function readArclength(page: Page): Promise<number> {
  const row = page.locator('.inspector-metrics__row', {
    has: page.locator('.inspector-metrics__label', { hasText: /^Arclength$/i }),
  })
  await expect(row.first()).toBeVisible()
  const text = (await row.first().locator('.inspector-metrics__value').innerText()).trim()
  const achieved = Number(text.split('/')[0]?.trim())
  if (!Number.isFinite(achieved)) throw new Error(`Invalid arclength metric: ${text}`)
  return achieved
}

async function expectGroupArclength(page: Page, names: string[], expected: number) {
  const harness = createHarness(page)
  for (const name of names) {
    await harness.selectTreeNode(`Branch: ${name}`)
    await harness.openDisclosure('branch-summary-toggle')
    expect(await readArclength(page)).toBeCloseTo(expected, 7)
  }
}

test('Henon two-cycle stable manifold phases initialize and extend at one physical length', async ({
  page,
}) => {
  // Two real-WASM group solves can share CPU with several other numerical
  // Playwright workers in the full suite.
  test.setTimeout(300_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.openSystem('Henon')
  await harness.createEquilibrium()
  await harness.selectTreeNode('Fixed_point_1')

  await page.getByTestId('action-equilibrium-solver-toggle').click()
  await page.getByTestId('equilibrium-solve-guess-0').fill('-0.4758000511750577')
  await page.getByTestId('equilibrium-solve-guess-1').fill('0.2927400153525173')
  await page.getByTestId('equilibrium-solve-cycle-length').fill('2')
  await page.getByTestId('equilibrium-solve-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await expect(page.getByText(/^Solved$/)).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('action-equilibrium-manifold-toggle').click()
  await page.getByTestId('equilibrium-manifold-name').fill('henon_equal_stable')
  await page.getByTestId('equilibrium-manifold-stability').selectOption('Stable')
  await page.getByTestId('equilibrium-manifold-direction').selectOption('Both')
  await page.getByTestId('equilibrium-manifold-eig-index').selectOption('1')
  await page.getByTestId('equilibrium-manifold-target-arclength').fill('2')
  await page.getByTestId('equilibrium-manifold-caps-max-points').fill('2000')
  await page.getByTestId('equilibrium-manifold-caps-max-iterations').fill('64')
  await page.getByTestId('equilibrium-manifold-submit').click()

  const names = [
    'henon_equal_stable_p1_plus',
    'henon_equal_stable_p1_minus',
    'henon_equal_stable_p2_plus',
    'henon_equal_stable_p2_minus',
  ]
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 })
  for (const name of names) {
    await expect(
      page.locator('[data-testid^="object-tree-node-"]').filter({ hasText: `Branch: ${name}` })
    ).toBeVisible()
  }
  await expectGroupArclength(page, names, 2)

  await harness.selectTreeNode(`Branch: ${names[0]}`)
  await page.getByTestId('action-manifold-extend-toggle').click()
  await page.getByTestId('manifold-extend-arclength').fill('2')
  await page.getByTestId('manifold-extend-max-points').fill('2000')
  await page.getByTestId('manifold-extend-max-iterations').fill('64')
  await page.getByTestId('manifold-extend-submit').click()
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByTestId('inspector-workflow-back').click()

  await expectGroupArclength(page, names, 4)
})
