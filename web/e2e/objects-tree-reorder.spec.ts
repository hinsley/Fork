import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('object tree native drag reorders with a live preview', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true, fixture: 'demo' })
  await harness.openSystem('Demo_System')

  const originalBranch = page
    .locator('[data-testid^="object-tree-row-"]')
    .filter({ hasText: 'Branch: eq_branch (equilibrium)' })
    .first()
  await originalBranch.click({ button: 'right' })
  await page.getByTestId('object-context-duplicate').click()

  const copiedBranch = page
    .locator('[data-testid^="object-tree-row-"]')
    .filter({ hasText: 'Branch: eq_branch_copy (equilibrium)' })
  await expect(copiedBranch).toHaveCount(1)

  const branchLabels = async () =>
    await page.locator('[data-testid^="object-tree-row-"]').evaluateAll((rows) =>
      rows
        .map((row) => row.textContent?.trim() ?? '')
        .filter((label) => label.startsWith('Branch:'))
    )

  await expect.poll(branchLabels).toEqual([
    'Branch: eq_branch (equilibrium)',
    'Branch: eq_branch_copy (equilibrium)',
  ])

  const sourceBox = await copiedBranch.boundingBox()
  const targetBox = await originalBranch.boundingBox()
  if (!sourceBox || !targetBox) {
    throw new Error('Expected source and target rows to be visible.')
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, targetBox.y + targetBox.height * 0.25, {
    steps: 12,
  })

  await expect.poll(branchLabels).toEqual([
    'Branch: eq_branch_copy (equilibrium)',
    'Branch: eq_branch (equilibrium)',
  ])

  await page.mouse.up()

  await expect.poll(branchLabels).toEqual([
    'Branch: eq_branch_copy (equilibrium)',
    'Branch: eq_branch (equilibrium)',
  ])
})

test('object tree native drag appends root objects from bottom whitespace', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })
  await harness.createSystem('Object_Tree_Bottom_Drop')
  await harness.createOrbit()
  await harness.createOrbit()

  const objectLabels = async () =>
    await page.locator('[data-testid^="object-tree-row-"]').evaluateAll((rows) =>
      rows
        .map((row) => row.textContent?.trim() ?? '')
        .filter((label) => label.startsWith('Orbit_'))
    )

  await expect.poll(objectLabels).toEqual(['Orbit_1 (orbit)', 'Orbit_2 (orbit)'])

  const source = page
    .locator('[data-testid^="object-tree-row-"]')
    .filter({ hasText: 'Orbit_1 (orbit)' })
  const sourceBox = await source.boundingBox()
  const panelBox = await page.getByTestId('objects-panel').boundingBox()
  if (!sourceBox || !panelBox) {
    throw new Error('Expected source row and objects panel to be visible.')
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, panelBox.y + panelBox.height - 24, {
    steps: 16,
  })

  await expect.poll(objectLabels).toEqual(['Orbit_2 (orbit)', 'Orbit_1 (orbit)'])

  await page.mouse.move(panelBox.x + panelBox.width + 120, panelBox.y + 80, { steps: 8 })
  await page.mouse.up()

  await expect.poll(objectLabels).toEqual(['Orbit_2 (orbit)', 'Orbit_1 (orbit)'])
})

test('object tree native drag prepends root objects from space above the tree', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })
  await harness.createSystem('Object_Tree_Top_Drop')
  await harness.createOrbit()
  await harness.createOrbit()

  const objectLabels = async () =>
    await page.locator('[data-testid^="object-tree-row-"]').evaluateAll((rows) =>
      rows
        .map((row) => row.textContent?.trim() ?? '')
        .filter((label) => label.startsWith('Orbit_'))
    )

  await expect.poll(objectLabels).toEqual(['Orbit_1 (orbit)', 'Orbit_2 (orbit)'])

  const source = page
    .locator('[data-testid^="object-tree-row-"]')
    .filter({ hasText: 'Orbit_2 (orbit)' })
  const sourceBox = await source.boundingBox()
  const panelBox = await page.getByTestId('objects-panel').boundingBox()
  if (!sourceBox || !panelBox) {
    throw new Error('Expected source row and objects panel to be visible.')
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, panelBox.y + 12, { steps: 16 })

  await expect.poll(objectLabels).toEqual(['Orbit_2 (orbit)', 'Orbit_1 (orbit)'])

  await page.mouse.move(panelBox.x + panelBox.width + 120, panelBox.y + 80, { steps: 8 })
  await page.mouse.up()

  await expect.poll(objectLabels).toEqual(['Orbit_2 (orbit)', 'Orbit_1 (orbit)'])
})
