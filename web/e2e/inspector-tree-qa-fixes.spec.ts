import { expect, test, type Page } from '@playwright/test'
import { clickInspectorAction, createHarness } from './harness'

async function editSystem(page: Page, edit: () => Promise<void>) {
  await page.getByTestId('open-system-settings').click()
  await edit()
  await page.getByTestId('system-apply').click()
  await expect(page.getByText('Validating equations…')).toBeHidden()
  await page.getByTestId('close-system-settings').click()
}

async function addParameter(page: Page, index: number, name: string, value: string) {
  await page.getByTestId('system-add-parameter').click()
  await page.getByTestId(`system-param-${index}`).fill(name)
  await page.getByTestId(`system-param-value-${index}`).fill(value)
}

const treeRow = (page: Page, name: string) =>
  page
    .locator('[data-testid^="object-tree-row-"]')
    .filter({ has: page.getByRole('button', { name: new RegExp(`^${name} \\(`) }) })

test('orbit rerun keeps its length and a blow-up is flagged as diverged', async ({ page }) => {
  test.setTimeout(90_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('Orbit_QA_Fixes')
  await harness.createOrbit()
  await harness.selectTreeNode('Orbit_1')
  await clickInspectorAction(page, 'action-orbit-run-toggle')
  await page.getByTestId('orbit-run-ic-0').fill('0.5')
  await page.getByTestId('orbit-run-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  const meta = page.getByTestId('inspector-meta')
  await expect(meta).toContainText('10,001 points')

  // The prefilled duration is the clean span, so a rerun gives the same length.
  await clickInspectorAction(page, 'action-orbit-run-toggle')
  await expect(page.getByTestId('orbit-run-duration')).toHaveValue('100')
  await page.getByTestId('orbit-run-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await expect(meta).toContainText('10,001 points')
  await expect(meta).toContainText('t 0 → 100')
  await expect(page.getByTestId('inspector-status-chip')).toHaveCount(0)

  await editSystem(page, () => page.getByTestId('system-eq-0').fill('x^3'))
  await harness.selectTreeNode('Orbit_1')
  await clickInspectorAction(page, 'action-orbit-run-toggle')
  await page.getByTestId('orbit-run-ic-0').fill('1')
  await page.getByTestId('orbit-run-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  await expect(page.getByTestId('inspector-status-chip')).toHaveText('diverged')
  await expect(page.getByTestId('inspector-status-chip')).toHaveAttribute(
    'title',
    /non-finite at t = /
  )
  await expect(page.getByTestId('orbit-glance-final-state')).toContainText('Last finite state')
  await expect(treeRow(page, 'Orbit_1').locator('.tree-node__status')).toHaveText('diverged')
})

test('forced response glance shows the branch point the scene renders', async ({ page }) => {
  test.setTimeout(90_000)
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: false })
  await harness.createSystem('Forced_QA_Fixes')
  await editSystem(page, async () => {
    await addParameter(page, 0, 'omega', '2')
    await addParameter(page, 1, 'a', '0.4')
    await page.getByTestId('system-eq-0').fill('-x + a*cos(omega*t)')
    await page.getByTestId('system-eq-1').fill('-y')
    await page.getByTestId('system-periodic-forcing-enabled').check()
    await page.getByTestId('system-forcing-period-expression').fill('tau / omega')
  })
  await page.getByTestId('create-object-button').click()
  await page.getByTestId('create-forced-periodic-response').click()
  await clickInspectorAction(page, 'action-forced-response-solver-toggle')
  await page.getByTestId('forced-response-period-steps').fill('120')
  await page.getByTestId('forced-response-solve-submit').click()
  await page.getByTestId('inspector-workflow-back').click()
  const objectName = await harness.inspectorName().inputValue()
  await expect(page.getByTestId('forced-response-glance-forcing-period')).toHaveText('3.14159', {
    timeout: 20_000,
  })

  await clickInspectorAction(page, 'action-forced-response-continuation-toggle')
  await page.getByLabel('Max pts').fill('4')
  await page.getByTestId('forced-response-branch-submit').click()
  // Continuing renders the object at the new branch's endpoint; pick another point.
  await expect(page.getByTestId('branch-point-prev')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('branch-point-prev').click()
  await page.getByTestId('branch-point-render-lc').click()
  await expect(page.getByTestId('branch-point-render-lc')).toHaveCount(0)

  await harness.selectTreeNode(objectName)
  await expect(page.getByTestId('forced-response-render-target')).toBeVisible()
  const param = page.getByTestId('forced-response-glance-param')
  await expect(param).toBeVisible()
  const omega = Number((await param.innerText()).replace('−', '-'))
  expect(Number.isFinite(omega)).toBe(true)
  expect(omega).not.toBe(2)
  // Forcing period follows ω at the rendered point (period = 2π/ω).
  const forcing = Number(
    (await page.getByTestId('forced-response-glance-forcing-period').innerText()).replace('−', '-')
  )
  expect(forcing).toBeCloseTo((2 * Math.PI) / omega, 3)
  await expect(treeRow(page, objectName).locator('.tree-node__data')).toContainText(
    `T ${forcing.toPrecision(4).replace(/0+$/, '').replace(/\.$/, '')}`
  )

  await page.getByTestId('forced-response-render-stored').click()
  await expect(page.getByTestId('forced-response-render-target')).toHaveCount(0)
  await expect(page.getByTestId('forced-response-glance-forcing-period')).toHaveText('3.14159')
})

test('tree: duplicate rename, delete focus, header folder rename, readable summaries', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })
  await harness.createSystem('Tree_QA_Fixes')
  await harness.createOrbit()
  await harness.createOrbit()
  await harness.createOrbit()

  // F2 rename to a sibling's name is rejected and keeps the old name.
  const orbit2 = page.getByRole('button', { name: 'Orbit_2 (orbit)', exact: true })
  await orbit2.click()
  await page.keyboard.press('F2')
  const input = page.locator('[data-testid^="node-rename-input-"]')
  await input.fill('Orbit_1')
  await input.press('Enter')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await input.press('Escape')
  await expect(orbit2).toBeFocused()
  await expect(page.getByRole('button', { name: 'Orbit_1 (orbit)', exact: true })).toHaveCount(1)

  // Delete keeps focus in the tree on the next row.
  page.once('dialog', (dialog) => void dialog.accept())
  await page.keyboard.press('Delete')
  const orbit3 = page.getByRole('button', { name: 'Orbit_3 (orbit)', exact: true })
  await expect(orbit2).toHaveCount(0)
  await expect(orbit3).toBeFocused()
  await expect(harness.inspectorName()).toHaveValue('Orbit_3')

  // The panel's folder button starts naming the new folder.
  await page.getByTestId('create-folder-button').click()
  const folderInput = page.locator('[data-testid^="node-rename-input-"]')
  await expect(folderInput).toBeFocused()
  await expect(folderInput).toHaveValue('Folder_1')
  await folderInput.fill('Runs')
  await folderInput.press('Enter')
  await expect(page.getByRole('button', { name: 'Runs', exact: true })).toBeFocused()

  // Long names give way to the data summary; a summary is never cut to a stub.
  for (const name of ['Orbit_1', 'Orbit_3']) {
    await harness.selectTreeNode(name)
    await harness.runOrbit()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: `${name} (orbit)`, exact: true }).dblclick()
    const rename = page.locator('[data-testid^="node-rename-input-"]')
    await rename.fill(`${name}_with_a_rather_long_descriptive_name`)
    await rename.press('Enter')
  }
  const slots = await page.locator('.tree-node__data').evaluateAll((nodes) =>
    nodes.map((node) => {
      const text = node.querySelector('.tree-node__data-text') as HTMLElement
      const slot = node.getBoundingClientRect()
      const box = text.getBoundingClientRect()
      const shown = box.top < slot.bottom - 1 && slot.width > 0
      const charWidth = parseFloat(getComputedStyle(text).fontSize) * 0.55
      return { shown, width: box.width, minWidth: charWidth * 5, text: text.textContent }
    })
  )
  expect(slots.length).toBeGreaterThan(0)
  for (const slot of slots) {
    if (slot.shown) expect(slot.width, slot.text ?? '').toBeGreaterThanOrEqual(slot.minWidth)
  }
  const nameWidths = await page
    .locator('.tree-node__label')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width))
  for (const width of nameWidths) expect(width).toBeGreaterThan(30)
  const tree = page.getByTestId('objects-tree')
  expect(await tree.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
})
