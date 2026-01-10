# Fork Testing

## One-command run
- `npm test` (runs unit + component + E2E)

## Install Playwright browsers (first time)
- `npx playwright install`

## Test layers
- Unit tests: `web/src/**/*.test.ts` (pure logic)
- Component tests: `web/src/**/*.test.tsx` (Testing Library + jsdom)
- E2E smoke: `web/e2e/*.spec.ts` (Playwright)

## Commands
- Unit + component only: `npm run test:unit`
- E2E only: `npm run test:e2e`
- E2E headed: `npm run test:e2e:headed`
- If port 4173 is busy, Playwright will auto-pick a free port. Set `PLAYWRIGHT_PORT=####` to force a specific port.

## WASM mocking strategy
- All compute goes through the `ForkCoreClient` interface (`web/src/compute/ForkCoreClient.ts`).
- Tests inject `MockForkCoreClient` to avoid real WASM.
- E2E tests use `?mock=1` to force mock compute in the browser.
- The Hopf curve E2E test uses real WASM (no `mock=1`) and requires an up-to-date
  `crates/fork_wasm/pkg-web` build.
- Deterministic test mode: `?test=1` (or `?deterministic=1`, or `VITE_DETERMINISTIC_TEST=1`) disables
  persistence, clears `localStorage`, freezes IDs/time, and disables animations for stable UI assertions.
- Optional deterministic fixture: `?fixture=demo` loads a canned system for external agents.

## Playwright harness
Use `web/e2e/harness.ts` for repeatable UI flows in deterministic mode.

```ts
import { test, expect } from '@playwright/test'
import { createHarness } from './harness'

test('happy path', async ({ page }) => {
  const harness = createHarness(page)
  await harness.goto({ deterministic: true, mock: true })
  await harness.createSystem('Demo')
  await harness.createOrbit()
  await harness.selectTreeNode('Orbit 1')
  await expect(harness.inspectorName()).toHaveValue(/Orbit 1/i)
})
```

## Stable selectors
- Key UI elements include `data-testid`:
  - `objects-tree`, `inspector-panel`, `branch-viewer-panel`, `plotly-viewport`
  - `create-orbit`, `create-equilibrium`, `system-name-input`, `create-system`
  - `splitter-left`, `splitter-right`
