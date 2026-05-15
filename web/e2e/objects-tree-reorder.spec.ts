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
