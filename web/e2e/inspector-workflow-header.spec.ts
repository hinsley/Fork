import { expect, test } from '@playwright/test'
import { createHarness } from './harness'

test('inspector child contexts animate forward and backward within the panel', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: false, mock: true })
  await harness.openSystem('Lorenz')
  await harness.createOrbit()

  const panel = page.getByTestId('inspector-panel-body')
  await panel.evaluate((panelElement) => {
    type NavigationRecord = { className: string; timing: string }
    const testWindow = window as typeof window & {
      inspectorNavigationObserver?: MutationObserver
      inspectorNavigationRecords?: NavigationRecord[]
    }
    const records: NavigationRecord[] = []
    const capture = () => {
      const pageElement = panelElement.querySelector('.inspector-navigation-page')
      if (!(pageElement instanceof HTMLElement)) return
      records.push({
        className: pageElement.className,
        timing: getComputedStyle(pageElement).animationTimingFunction,
      })
    }
    const observer = new MutationObserver(capture)
    observer.observe(panelElement, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
    })
    testWindow.inspectorNavigationObserver = observer
    testWindow.inspectorNavigationRecords = records
  })

  await expect(page.getByTestId('inspector-name')).toBeVisible()
  await page.getByTestId('action-orbit-run-toggle').click()
  await expect(page.getByTestId('inspector-workflow-back')).toBeVisible()
  await expect(page.getByTestId('inspector-name')).toHaveCount(0)
  await expect(panel).toHaveAttribute('data-navigation-phase', 'idle')

  await page.getByTestId('inspector-workflow-back').click()
  await expect(page.getByTestId('inspector-name')).toBeVisible()
  await expect(panel).toHaveAttribute('data-navigation-phase', 'idle')

  const records = await page.evaluate(() => {
    const testWindow = window as typeof window & {
      inspectorNavigationObserver?: MutationObserver
      inspectorNavigationRecords?: Array<{ className: string; timing: string }>
    }
    testWindow.inspectorNavigationObserver?.disconnect()
    return testWindow.inspectorNavigationRecords ?? []
  })
  expect(records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        className: expect.stringContaining('inspector-navigation-page--exiting-forward'),
        timing: 'cubic-bezier(0.4, 0, 1, 1)',
      }),
      expect.objectContaining({
        className: expect.stringContaining('inspector-navigation-page--entering-forward'),
        timing: 'cubic-bezier(0, 0, 0.2, 1)',
      }),
      expect.objectContaining({
        className: expect.stringContaining('inspector-navigation-page--exiting-backward'),
        timing: 'cubic-bezier(0.4, 0, 1, 1)',
      }),
      expect.objectContaining({
        className: expect.stringContaining('inspector-navigation-page--entering-backward'),
        timing: 'cubic-bezier(0, 0, 0.2, 1)',
      }),
    ])
  )
})
