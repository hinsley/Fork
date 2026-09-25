import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createHarness } from './harness'

function handleConfirm(page: Page, expectedParts: string[], action: 'accept' | 'dismiss') {
  page.once('dialog', async (dialog) => {
    const message = dialog.message().toLowerCase()
    expectedParts.forEach((part) => {
      expect(message).toContain(part.toLowerCase())
    })
    if (action === 'accept') {
      await dialog.accept()
    } else {
      await dialog.dismiss()
    }
  })
}

test('system delete asks for confirmation', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  const systemName = 'Confirm_Delete_System'
  await harness.createSystem(systemName)

  await page.getByTestId('open-systems').click()
  const dialog = page.getByRole('dialog')
  const systemRow = dialog.locator('.dialog__list-row', { hasText: systemName })
  await expect(systemRow).toBeVisible()

  handleConfirm(page, ['delete', systemName], 'dismiss')
  await systemRow.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(systemRow).toBeVisible()

  handleConfirm(page, ['delete', systemName], 'accept')
  await systemRow.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(systemRow).toHaveCount(0)

  // Deleting the open system closes it: home, no stale workspace or dialog.
  await expect(page.getByTestId('home')).toBeVisible()
  await expect(page.getByTestId('workspace')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByTestId('system-library').getByRole('button', { name: systemName, exact: true })
  ).toHaveCount(0)
})

test('creating a system with an existing name is rejected inline', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  const library = page.getByTestId('system-library')
  const lorenzRows = library.getByRole('button', { name: 'Lorenz', exact: true })
  await expect(lorenzRows).toHaveCount(1)
  await library.getByTestId('system-name-input').fill('lorenz')
  await library.getByTestId('create-system').click()
  await expect(library.getByRole('alert')).toHaveText('"Lorenz" already exists.')
  await expect(page.getByTestId('workspace')).toHaveCount(0)
  await expect(lorenzRows).toHaveCount(1)
})

test('object delete asks for confirmation', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('Object_Delete_Confirm')
  await harness.createOrbit()

  const objectRow = page
    .locator('[data-testid^="object-tree-row-"]')
    .filter({ hasText: 'Orbit_1' })
  await expect(objectRow).toHaveCount(1)

  await objectRow.first().click({ button: 'right' })
  await page.getByTestId('object-context-menu').waitFor()

  handleConfirm(page, ['delete', 'Orbit_1'], 'dismiss')
  await page.getByTestId('object-context-delete').click()
  await expect(objectRow).toHaveCount(1)

  await objectRow.first().click({ button: 'right' })
  await page.getByTestId('object-context-menu').waitFor()

  handleConfirm(page, ['delete', 'Orbit_1'], 'accept')
  await page.getByTestId('object-context-delete').click()
  await expect(objectRow).toHaveCount(0)
})

test('viewport delete asks for confirmation', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })

  await harness.createSystem('Viewport_Delete_Confirm')
  await harness.createScene()

  const viewportHeader = page.locator('[data-testid^="viewport-header-"]').first()
  await expect(viewportHeader).toBeVisible()

  await viewportHeader.click({ button: 'right' })
  await page.getByTestId('viewport-context-menu').waitFor()

  handleConfirm(page, ['delete', 'Scene_1'], 'dismiss')
  await page.getByTestId('viewport-context-delete').click()
  await expect(viewportHeader).toBeVisible()

  await viewportHeader.click({ button: 'right' })
  await page.getByTestId('viewport-context-menu').waitFor()

  handleConfirm(page, ['delete', 'Scene_1'], 'accept')
  await page.getByTestId('viewport-context-delete').click()
  await expect(page.getByTestId('viewport-insert-empty')).toBeVisible()
})
