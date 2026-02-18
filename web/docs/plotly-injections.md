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
  `buildDiagramBaseLayout()` only include declarative layout (axis titles,
  grids, styling). Scene layout mode is resolved from per-scene axis selection:
  3-axis scenes use Plotly `scene` camera layouts; 1-axis and 2-axis scenes use
  2D `xaxis`/`yaxis` layouts (`dragmode: 'pan'` for 2-axis projections).
- `web/src/ui/ViewportPanel.tsx`: scene projection mode is now selected by
  scene axis count (`Scene.axisVariables`), not by system dimension:
  `flow_timeseries_1d`, `map_cobweb_1d`, `phase_2d`, `phase_3d`.
- `web/src/ui/ViewportPanel.tsx`: 1-axis map scenes for systems with more than
  one variable render cobweb projection (`x_n` vs `x_{n+1}`) for the selected
  variable and intentionally do **not** render a governing map function graph.
- `web/src/ui/ViewportPanel.tsx`: `buildSceneInitialView()` and
  `buildDiagramInitialView()` translate stored `scene.camera` / `axisRanges`
  (if present) into a one-time `initialView` payload for `usePlotViewport`.
  `scene.camera` is only restored for 3-axis projections; 1-axis and 2-axis
  projections restore axis ranges.
- `web/src/ui/ViewportPanel.tsx`: map function sampling requests are limited to
  true 1D map systems (`varNames.length === 1`) and only when at least one
  visible scene is currently in `map_cobweb_1d` mode.
- `web/src/ui/ViewportPanel.tsx`: `buildDiagramBaseLayout()` disables legend
  item click/double-click toggles (`legend.itemclick`/`legend.itemdoubleclick`)
  so bifurcation visibility is managed only via the object tree.
- `web/src/ui/ViewportPanel.tsx`: Scene branch rendering policy for continuation
  objects:
  - equilibrium and codim-1 bifurcation curves render as `lines` (no per-point
    markers);
  - invariant manifold branches render from persisted `manifold_geometry`:
    `eq_manifold_1d` as line traces, and `eq_manifold_2d` /
    `cycle_manifold_2d` as per-ring closed line traces (no mesh fill) in both
    3-axis and 2-axis scene projections;
  - codim-2 points from `branch.data.bifurcations` render as dedicated diamond
    marker traces;
  - selected branch-point markers in scenes use the same dedicated selected
    marker style as bifurcation diagrams (`circle-open` overlay);
  - selected orbit-point markers in scenes render as dedicated `circle-open`
    overlay traces so inspector point selection is visible in state space;
  - cycle-like continuation branches (limit cycle, isochrone, homoclinic
    related) use envelope rendering (min/max traces) for one-free-variable
    projections, rather than plotting every cycle profile point.
- `web/src/App.css`: `.viewport-tile--diagram` overrides Plotly legend cursor
  styles to avoid implying an independent visibility toggle in bifurcation
  diagrams.
- `web/src/App.css`: Plotly SVG text colors are forced via the
  `--plotly-text`/`--plotly-text-muted` CSS variables so new themes can
  override text contrast without touching Plotly layout code.
- `web/src/ui/InspectorDetailsPanel.tsx`: eigenvalue/multiplier plots set
  `dragmode: 'pan'`, compute fixed `xaxis.range`/`yaxis.range` values for the
  complex plane, and add unit circle/disc overlays for multiplier/eigenvalue
  views. Equilibrium eigenvalue markers are color-mapped from the corresponding
  eigenvector/eigendisc render colors (no relayout persistence is wired for
  these mini plots).

### Plot styling driven by app theme
- `web/src/viewports/plotly/plotlyTheme.ts`: `resolvePlotlyThemeTokens()` is
  used to set `paper_bgcolor`, `plot_bgcolor`, and text/annotation/legend font
  colors in Plotly layouts.

## Test-only hooks (non-runtime)

- `web/e2e/clv-arrow-selection.spec.ts`: uses Plotly's event emitter
  (`node.emit('plotly_click', ...)`) to simulate click events in tests.
- `web/e2e/orbit-scene-point-selection.spec.ts`: uses Plotly's event emitter
  (`node.emit('plotly_click', ...)`) to simulate orbit-point scene clicks and
  verify Orbit Data preview selection/page jumps.
- `web/e2e/plotly-view-state.spec.ts`: reads `node._fullLayout` to inspect
  camera state in tests.
- `web/src/test/setup.ts`: mocks `plotlyAdapter` to avoid loading Plotly during
  unit tests.
