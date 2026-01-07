# Fork Web Testing

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

## WASM mocking strategy
- All compute goes through the `ForkCoreClient` interface (`web/src/compute/ForkCoreClient.ts`).
- Tests inject `MockForkCoreClient` to avoid real WASM.
- E2E tests use `?mock=1` to force mock compute in the browser.
- Optional deterministic fixture: `?fixture=demo` loads a canned system for external agents.

## Stable selectors
- Key UI elements include `data-testid`:
  - `objects-tree`, `inspector-panel`, `branch-viewer-panel`, `plotly-viewport`
  - `create-orbit`, `create-equilibrium`, `system-name-input`, `create-system`
  - `splitter-left`, `splitter-right`
