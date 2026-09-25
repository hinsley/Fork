import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('object tree supports keyboard navigation, visibility, rename and folders', async ({
  page,
}) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })
  await harness.createSystem('Object_Tree_Keyboard')
  await harness.createOrbit()
  await harness.createOrbit()

  const orbit1 = page.getByRole('button', { name: 'Orbit_1 (orbit)', exact: true })
  const orbit2 = page.getByRole('button', { name: 'Orbit_2 (orbit)', exact: true })
  const row = (name: string) =>
    page
      .locator('[data-testid^="object-tree-row-"]')
      .filter({ has: page.getByRole('button', { name, exact: true }) })

  await orbit1.click()
  await expect(harness.inspectorName()).toHaveValue('Orbit_1')
  await page.keyboard.press('ArrowDown')
  await expect(orbit2).toBeFocused()
  await expect(harness.inspectorName()).toHaveValue('Orbit_2')

  // Space toggles visibility without re-selecting through the button.
  await page.keyboard.press('Space')
  await expect(row('Orbit_2 (orbit)').locator('[data-testid^="node-visibility-"]')).toHaveAttribute(
    'data-visible',
    'false'
  )
  await expect(row('Orbit_2 (orbit)')).toHaveClass(/tree-node__row--hidden/)
  await page.keyboard.press('Space')
  await expect(row('Orbit_2 (orbit)').locator('[data-testid^="node-visibility-"]')).toHaveAttribute(
    'data-visible',
    'true'
  )

  // F2 renames inline.
  await page.keyboard.press('F2')
  const input = page.locator('[data-testid^="node-rename-input-"]')
  await expect(input).toBeFocused()
  await input.fill('Orbit_Renamed')
  await input.press('Enter')
  await expect(page.getByRole('button', { name: 'Orbit_Renamed (orbit)', exact: true })).toBeFocused()

  // Wrapping an object in a folder keeps its position and starts renaming the folder.
  await row('Orbit_1 (orbit)').click({ button: 'right' })
  await page.getByTestId('object-context-create-folder').click()
  const folderInput = page.locator('[data-testid^="node-rename-input-"]')
  await expect(folderInput).toHaveValue('Folder_1')
  await folderInput.fill('Group_A')
  await folderInput.press('Enter')
  const labels = await page
    .locator('[data-testid^="object-tree-node-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  expect(labels).toEqual(['Group_A', 'Orbit_1 (orbit)', 'Orbit_Renamed (orbit)'])

  // Header create button never wraps.
  const createButton = page.getByTestId('create-object-button')
  const box = await createButton.boundingBox()
  expect(box?.height ?? 0).toBeLessThanOrEqual(34)
})
