# Plotly integration touchpoints

This file enumerates every place in the web UI that reaches into Plotly beyond
just providing data and layout objects. It covers event listeners, forced
updates, and any layout/state overrides that can change Plotly's default
behavior.

## Runtime touchpoints

### Plotly lifecycle and render config
- `web/src/viewports/plotly/plotlyAdapter.ts`: `renderPlot()` uses
  `Plotly.react()` on every `data`/`layout` change (forced rerender). It passes
  a config that changes defaults: `displaylogo: false`, `displayModeBar: true`,
  `responsive: true`, `scrollZoom: true`, `doubleClick: false`.
- `web/src/viewports/plotly/plotlyAdapter.ts`: wraps `Plotly.react()`,
  `Plotly.newPlot()`, and `Plotly.Plots.resize()` with test-only perf counters
  when `window.__E2E__` is enabled.
- `web/src/viewports/plotly/plotlyAdapter.ts`: injects the current 3D camera
  into `Plotly.react()` when `uirevision` is stable and the incoming layout does
  not specify a camera. The guard only uses a validated camera spec (no model
  persistence, no continuous injection) to prevent the first style update from
  resetting the camera.
- `web/src/viewports/plotly/plotlyAdapter.ts`: `relayoutPlot()` wraps
  `Plotly.relayout()` for one-time view restores.
- `web/src/viewports/plotly/PlotlyViewport.tsx`: `preloadPlotly()` is invoked on
  mount to kick off dynamic import.
- `web/src/viewports/plotly/PlotlyViewport.tsx`: `purgePlot()` is called on
  unmount to clear the plot via `Plotly.purge()`.
- `web/src/viewports/plotly/plotlyAdapter.ts`: the loaded Plotly module is
  assigned to `window.Plotly` so browser tests can invoke `Plotly.relayout`.

### Plotly event listeners
- `web/src/viewports/plotly/PlotlyViewport.tsx`: `plotly_click` handler is
  registered on the plot container (via `node.on`) and removed on cleanup. It
  maps Plotly click payloads into `PlotlyPointClick` objects for selection.
- `web/src/viewports/plotly/PlotlyViewport.tsx`: `plotly_relayout` handler is
  registered on the plot container (via `node.on`) and removed on cleanup. When
  view persistence is enabled, it forwards relayout events into
  `usePlotViewport` for snapshot capture (no model updates).

### Viewport controller hook (`usePlotViewport`)
- `web/src/viewports/plotly/usePlotViewport.ts`: computes a stable
  `uirevision` key (`plotId:viewRevision`) for each plot and hands it to
  `PlotlyViewport`, which injects `layout.uirevision` (and `layout.scene.uirevision`)
  to keep Plotly UI state stable across renders.
- `web/src/viewports/plotly/usePlotViewport.ts`: `ResizeObserver` drives
  `resizePlot()` (which calls `Plotly.Plots.resize`) and fires `onResize` with
  container bounds; throttled via `requestAnimationFrame`.
- `web/src/viewports/plotly/usePlotViewport.ts`: debounced capture of view
  relayouts (axis ranges + `scene.camera`) into an in-memory snapshot store.
- `web/src/viewports/plotly/usePlotViewport.ts`: one-time view restore via
  `relayoutPlot()` using a stored snapshot or `initialView` payload.

### Layout/state overrides that influence view state
- `web/src/ui/ViewportPanel.tsx`: `buildSceneBaseLayout()` and
  `buildDiagramBaseLayout()` set `dragmode: 'pan'` for 2D scenes/diagrams and
  only include declarative layout (axis titles, grids, styling). They do not
  inject camera or axis ranges.
- `web/src/ui/ViewportPanel.tsx`: `buildSceneInitialView()` and
  `buildDiagramInitialView()` translate stored `scene.camera` / `axisRanges` (if
  present) into a one-time `initialView` payload for `usePlotViewport`.
- `web/src/ui/ViewportPanel.tsx`: `buildDiagramBaseLayout()` disables legend
  item click/double-click toggles (`legend.itemclick`/`legend.itemdoubleclick`)
  so bifurcation visibility is managed only via the object tree.
- `web/src/App.css`: `.viewport-tile--diagram` overrides Plotly legend cursor
  styles to avoid implying an independent visibility toggle in bifurcation
  diagrams.
- `web/src/ui/InspectorDetailsPanel.tsx`: eigenvalue/multiplier plots set
  `dragmode: 'pan'`, compute fixed `xaxis.range`/`yaxis.range` values for the
  complex plane, and add unit circle/disc overlays for multiplier/eigenvalue
  views (no relayout persistence is wired for these mini plots).

### Plot styling driven by app theme
- `web/src/viewports/plotly/plotlyTheme.ts`: `resolvePlotlyBackgroundColor()` is
  used to set `paper_bgcolor` and `plot_bgcolor` in layouts.

## Test-only hooks (non-runtime)

- `web/e2e/clv-arrow-selection.spec.ts`: uses Plotly's event emitter
  (`node.emit('plotly_click', ...)`) to simulate click events in tests.
- `web/e2e/plotly-view-state.spec.ts`: reads `node._fullLayout` to inspect
  camera state in tests.
- `web/src/test/setup.ts`: mocks `plotlyAdapter` to avoid loading Plotly during
  unit tests.
