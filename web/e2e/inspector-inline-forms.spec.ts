import { expect, test } from '@playwright/test'
import { clickInspectorAction, createHarness } from './harness'

// Forms that are the main content of an object's inspector render inline,
// not behind an action button.
test('equilibrium solver and isocline settings are inline; orbit extends from Simulation', async ({
  page,
}) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })
  await harness.openSystem('Lorenz')

  await harness.createEquilibrium()
  await harness.selectTreeNode('Equilibrium_1')
  await expect(page.getByTestId('equilibrium-solver-section')).toBeVisible()
  await expect(page.getByTestId('action-equilibrium-solver-toggle')).toHaveCount(0)
  await harness.solveEquilibrium()
  await expect(page.getByTestId('inspector-meta')).toContainText('Solved')
  await expect(page.getByTestId('equilibrium-solve-submit')).toBeVisible()

  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-isocline').click()
  await harness.selectTreeNode('Isocline_1')
  await expect(page.getByTestId('isocline-section')).toBeVisible()
  await expect(page.getByTestId('action-isocline-toggle')).toHaveCount(0)

  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await expect(page.getByTestId('action-orbit-run-toggle')).toHaveText('Simulation')
  await expect(page.getByTestId('orbit-extend-quick')).toHaveCount(0)
  await clickInspectorAction(page, 'action-orbit-run-toggle')
  await page.getByTestId('orbit-run-submit').click()
  await expect(page.getByTestId('orbit-extend-submit')).toHaveText('Extend from t = 100')
  await page.getByTestId('orbit-extend-submit').click()
  await expect(page.getByTestId('orbit-extend-submit')).toHaveText('Extend from t = 200')
})
