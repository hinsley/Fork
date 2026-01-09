# Design Decision Log

This log captures small but impactful implementation decisions so future work (including AI agents)
does not unknowingly regress behavior. Add entries when you make a choice that is not obvious from
the code alone or when you introduce a workaround, shim, or architectural constraint.

## How to add an entry
- Append newest entries at the top.
- Keep entries short and concrete: what/why/impact + where to find it.
- Prefer ASCII text.

Template:
```
### YYYY-MM-DD: Title
Context:
Decision:
Why:
Impact:
References:
```

---

### 2026-01-09: Enforce CLI-safe names across the UI
Context:
Web object/branch defaults historically used spaces, while the CLI requires names to be
alphanumeric with underscores only for storage and command parity.
Decision:
Treat object/branch/system names as CLI-safe identifiers (`[a-zA-Z0-9_]`) everywhere.
Web defaults now sanitize spaces to underscores and UI validation blocks invalid names.
Why:
Prevents CLI/web mismatch and avoids invalid filenames when persisting objects and branches.
Impact:
Creation/rename flows in the web UI now reject non-CLI-safe names and suggest underscore defaults.
References:
`cli/src/naming.ts`, `web/src/utils/naming.ts`, `web/src/state/appState.tsx`,
`web/src/ui/InspectorDetailsPanel.tsx`, `web/src/App.tsx`

### 2026-01-08: Split system UI persistence from core data
Context:
The web UI now needs per-project layout/render state (viewport sizing/order, render styles, etc.)
without rewriting large analysis payloads on every UI tweak.
Decision:
Persist core system data to `system.json` and UI state to `ui.json` in OPFS. Export/import uses a
combined project bundle (`system` + `ui`) and merges on load, falling back to legacy bundles when
`ui.json` is missing.
Why:
Keeps UI saves lightweight while ensuring exported systems recreate the same visual setup.
Impact:
Adds split serialization helpers and a `saveUi` path; UI edits debounce their own persistence.
References:
`web/src/system/serialization.ts`, `web/src/system/opfs.ts`, `web/src/state/appState.tsx`,
`web/src/ui/ViewportPanel.tsx`

### 2025-01-08: Viewport nodes live in the object tree
Context:
The UI needs multiple viewports (state-space scenes + bifurcation diagrams) that can be reordered and configured.
Decision:
Represent viewports as root `TreeNode` entries of kind `scene` or `diagram`, with configs stored in
`project.scenes` and `project.bifurcationDiagrams`. `createProject` seeds a default Main Scene node,
and `normalizeProject` backfills missing nodes for older projects. The viewport grid uses root order
and HTML5 drag handles to reorder nodes via `reorderNode`. Bifurcation viewports render a Plotly
placeholder annotation until UX is co-designed.
Why:
Keeps viewports in the same object model as other assets while enabling a DCC-style layout without
locking in bifurcation rendering decisions.
Impact:
Scene/diagram visibility toggles hide viewport tiles; viewport Plotly test IDs are now per-node.
References:
`web/src/project/model.ts`, `web/src/project/serialization.ts`, `web/src/ui/ViewportPanel.tsx`,
`web/src/ui/InspectorDetailsPanel.tsx`

### 2025-01-07: Lazy-load Plotly via adapter
Context:
Plotly bloats the main bundle; we want initial UI to load fast without changing the Plotly API surface.
Decision:
Load Plotly dynamically inside `plotlyAdapter.ts` with a cached promise and expose `preloadPlotly`/`isPlotlyLoaded`.
`PlotlyViewport` shows a lightweight loading overlay until Plotly is ready.
Why:
Keeps future feature work on Plotly unchanged while reducing the main bundle size.
Impact:
Viewport renders asynchronously on first load; unit tests must mock the adapter exports.
References:
`web/src/viewports/plotly/plotlyAdapter.ts`, `web/src/viewports/plotly/PlotlyViewport.tsx`,
`web/src/test/setup.ts`

### 2025-01-07: WASM equation validation uses worker + alias
Context:
System equation validation should run in Fork Core (WASM) without blocking the main thread.
Decision:
Run validation in the worker by attempting to construct `WasmSystem`; fall back to per-equation
attempts to surface specific parse errors. Use a Vite alias `@fork-wasm` to load the local
`crates/fork_wasm/pkg-web/fork_wasm.js`, and set `worker.format = "es"` for Vite builds.
Why:
Avoids UI freezes and keeps validation in core logic while making the worker buildable in Vite.
Impact:
Build requires a local `crates/fork_wasm/pkg-web` (built via `wasm-pack --target web --out-dir pkg-web`).
Type shims exist for
the WASM module, Plotly, and OPFS iterator typings.
References:
`web/src/compute/worker/forkCoreWorker.ts`, `web/vite.config.ts`,
`web/src/types/wasm.d.ts`, `web/src/types/plotly.d.ts`, `web/src/types/fileSystem.d.ts`,
`web/src/ui/InspectorDetailsPanel.tsx`
