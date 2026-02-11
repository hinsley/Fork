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

### 2026-02-11: Object-scoped frozen-variable subsystems as compute context
Context:
Fast-slow workflows require running solves/continuations in reduced subsystems where selected state
variables are frozen, while preserving consistent full-system display behavior.
Decision:
Make frozen-variable subsystem configuration object-scoped and snapshot-based. All compute calls go
through the subsystem gateway, which builds reduced run configs and maps states between reduced and
full coordinates. Persist reduced-canonical computed states and immutable subsystem snapshots on
branches/derived objects.
Why:
Keeps the model modular and reproducible while avoiding ad hoc per-solver reduction logic.
Impact:
Objects define their own frozen context; branches inherit immutable snapshots; UI renders by embedding
reduced states into full-system coordinates with per-point projection overrides for frozen continuation
parameters.
References:
`web/src/system/subsystemGateway.ts`, `web/src/system/types.ts`,
`web/src/state/appState.tsx`, `docs/frozen_variable_subsystems.md`

### 2026-02-11: Frozen continuation parameter identity split between runtime and persisted metadata
Context:
Codim-1 branch extension and projection regressions occurred when frozen-variable continuation
parameters were encoded only as display labels or only as runtime names.
Decision:
Use explicit persisted refs (`ParameterRef`) as source-of-truth metadata; convert to runtime parameter
names (including generated `fv__...`) only at compute/extension request boundaries. On extension
results, restore/preserve two-parameter metadata and display labels for stored branch data.
Why:
Prevents unknown-parameter errors at runtime and avoids post-extension projection collapse along
secondary frozen continuation parameters.
Impact:
Extension requests reliably use runtime names; stored branches remain display-stable; scene and
inspector projection can recover frozen param2 semantics even if response payloads omit branch-type
refs.
References:
`web/src/system/subsystemGateway.ts`, `web/src/state/appState.tsx`,
`web/src/ui/ViewportPanel.tsx`, `web/src/ui/InspectorDetailsPanel.tsx`

### 2026-02-11: Scene rendering policy parity for continuation branches
Context:
State-space scenes and bifurcation diagrams needed aligned branch rendering semantics and selected-point
feedback for continuation objects.
Decision:
Standardize scene rendering so equilibrium and codim-1 bifurcation curves render as line traces with
dedicated codim-2 marker overlays only. Keep selected branch-point markers unified with diagram style,
and render envelopes (not full profile point clouds) for cycle-like continuation branches when one free
state axis is plotted.
Why:
Reduces visual noise and keeps scene behavior consistent with diagram interpretation.
Impact:
Codim-1 curves no longer render per-point markers in scenes, codim-2 points remain explicit, and
cycle-like one-free-axis projections use min/max envelopes for continuation branches.
References:
`web/src/ui/ViewportPanel.tsx`, `web/src/ui/ViewportPanel.test.tsx`,
`docs/frozen_variable_subsystems.md`

### 2026-01-22: Decouple map vs flow continuations only when taxonomy diverges
Context:
Some bifurcation continuation handlers share map/flow logic with label switches (e.g., PD
cycle vs limit cycle; Hopf vs Neimark-Sacker). We considered splitting all map/flow
continuations for consistency.
Decision:
Decouple only when map and flow represent different object types or initiation algorithms.
Keep shared handlers where the math/object is the same (e.g., fold curve continuation,
equilibrium continuation with mapIterations gating). Split PD cycle vs limit cycle now and
track Hopf vs Neimark-Sacker as a follow-on task.
Why:
Reduces accidental taxonomy drift without adding needless code duplication.
Impact:
Map PD cycle and flow PD limit cycle are separate actions; Hopf/NS will be split. Fold and
equilibrium continuations remain shared with mapIterations-specific configuration.
References:
`web/src/state/appState.tsx`, `web/src/ui/InspectorDetailsPanel.tsx`, bead Fork-os5v,
bead Fork-p1vn, epic Fork-oag1

### 2026-01-24: Neutral cursor for bifurcation legends
Context:
Bifurcation diagrams render a Plotly legend for labels, but legend toggles are disabled so object
visibility is controlled solely by the object tree. Plotly still shows a pointer cursor on legend
items, implying a separate visibility toggle that is not wired to object menu state.
Decision:
Add a diagram-scoped CSS override to force the legend cursor to `default` for bifurcation viewports.
Why:
Avoids suggesting an independent visible/hidden control that could drift from object menu state.
Impact:
Legend labels remain visible, but no interactive cursor appears on bifurcation diagrams.
References:
`web/src/App.css`, `web/src/ui/ViewportPanel.tsx`

### 2026-01-20: Accept 1D map samples after StrictMode effect cleanup
Context:
In React StrictMode, effects run and clean up immediately on first mount. The initial map sampling
request can be aborted in cleanup, but the worker can still resolve with a usable result. A global
mounted flag made us drop that completion forever, leaving the map graph blank until another UI
change retriggered sampling.
Decision:
Use a per-effect disposed flag and the current map key to ignore only truly stale results; accept
the first completed sample if the map key still matches, even if the initial effect cleanup ran.
Why:
Avoids a permanent "no samples" state on initial load while still guarding against out-of-date
responses when the map configuration changes.
Impact:
1D map graphs render on first load; subsequent range/config changes still discard stale samples.
References:
`web/src/ui/ViewportPanel.tsx`

### 2026-01-23: Store cycle points for map fixed-point solutions
Context:
Map fixed points can represent cycles via F^k(x) - x, but the UI needed the full orbit to render
all cycle points and show them in data tables.
Decision:
When solving or continuing map fixed points with mapIterations > 1, compute cycle_points by
iterating the map starting from the representative state and store the full list on the result.
The first point remains the representative for rendering and line traces.
Why:
Avoids re-running the map in the UI and keeps cycle rendering/inspection consistent across scenes
and bifurcation diagrams.
Impact:
Map fixed-point solutions optionally include cycle_points; flows are unchanged. UI renders cycle
tail points as circles with a diamond representative and shows a cycle table in the inspector.
References:
`crates/fork_core/src/equilibrium.rs`, `crates/fork_core/src/continuation/equilibrium.rs`,
`crates/fork_core/src/continuation/problem.rs`, `crates/fork_core/src/continuation/types.rs`,
`crates/fork_wasm/src/continuation/shared.rs`, `web/src/ui/ViewportPanel.tsx`,
`web/src/ui/InspectorDetailsPanel.tsx`

### 2026-01-22: Continue from corrected step after bifurcation refinement
Context:
Refined bifurcation points can land on either side of the sign change, causing repeated detections
on subsequent steps even when the branch progresses past the crossing.
Decision:
Keep the refined point for the recorded bifurcation, but advance the continuation state from the
post-corrected step point (not the refined point) whenever a bifurcation is detected.
Why:
Avoids duplicate bifurcations while still storing the refined location for reporting and plotting.
Impact:
Continuation proceeds smoothly past bifurcations without repeated sign-change hits.
References:
`crates/fork_core/src/continuation.rs`

### 2026-01-21: Map period-doubling test uses determinant-style product
Context:
Map equilibrium continuation needed PD detection that stays well-defined when eigenvalues are
complex conjugate pairs.
Decision:
Compute the PD test as the product of (mu + 1) over real eigenvalues and |mu + 1|^2 for each complex
conjugate pair (equivalently det(J + I) for the map Jacobian).
Why:
This preserves the sign change at mu = -1 without introducing artificial zeros when the spectrum
is purely complex.
Impact:
Map fixed-point continuation uses a determinant-style PD test value with positive complex-pair
contributions.
References:
`crates/fork_core/src/continuation/util.rs`, `crates/fork_core/src/continuation/equilibrium.rs`,
`crates/fork_wasm/src/continuation/shared.rs`

### 2026-01-20: Map fixed points use cycle length in equilibrium solves
Context:
Map fixed points can represent cycles by solving F^k(x) - x, but we had no way to set k.
Decision:
Store mapIterations on map equilibrium solver params and continuation branches, and pass it through
core/wasm with a default of 1 when omitted.
Why:
Keeps fixed points and cycles unified in the same object type without changing flow behavior.
Impact:
Map solves and continuations iterate the map and Jacobians; legacy data fall back to 1.
References:
`crates/fork_core/src/equilibrium.rs`, `crates/fork_core/src/continuation/equilibrium.rs`,
`crates/fork_wasm/src/equilibrium.rs`, `web/src/state/appState.tsx`, `cli/src/index.ts`

### 2026-01-19: Neimark-Sacker test returns 0 without complex pairs
Context:
Map equilibrium continuation could falsely flag an NS at the first step when the starting Jacobian
had only real (e.g., zero) eigenvalues but the next step introduced a complex pair inside the unit
circle. The sign-change detector treated the missing-complex case as positive.
Decision:
Make the NS test function return 0.0 when no complex conjugate pairs exist, so sign-change detection
only triggers when both sides of a step have complex pairs.
Why:
Prevents false NS detections at the start of a branch without adding per-step guards.
Impact:
NS detection ignores steps where complex pairs are absent; true NS crossings still change sign.
References:
`crates/fork_core/src/continuation/util.rs`, `crates/fork_core/src/continuation/equilibrium.rs`

### 2026-01-17: Treat OPFS as Chromium-only persistence
Context:
The web app uses OPFS (File System Access API) for `system.json` and `ui.json`, but Safari and
Firefox do not implement `FileSystemFileHandle.createWritable` in stable builds.
Decision:
Treat OPFS as a Chromium-only storage backend and always gate it behind capability checks
(`navigator.storage.getDirectory` + `FileSystemFileHandle.createWritable`). Use IndexedDB as the
persistent fallback for non-Chromium browsers (memory fallback if IndexedDB fails).
Why:
Avoid runtime crashes while keeping persistence reliable across browsers.
Impact:
Any new persistence work must feature-detect OPFS and never assume `createWritable` exists.
Docs and tests should call out the IndexedDB fallback path. IndexedDB quotas vary by browser/device
and can be evicted under storage pressure, so persistence code should handle quota errors and avoid
assuming unlimited storage.
References:
`web/src/system/opfs.ts`, `web/src/system/indexedDb.ts`, `web/src/system/storeFactory.ts`,
`web/src/main.tsx`, `web/ARCHITECTURE.md`

### 2026-01-10: Build web WASM during deploy
Context:
Committing `pkg-web` kept hosted builds simple but added binary churn to the repo.
Decision:
Stop tracking `crates/fork_wasm/pkg-web` and generate it during web builds with
`wasm-pack build --target web --out-dir pkg-web`. Vercel installs Rust + wasm-pack
and runs this step before `npm run build`.
Why:
Keeps the repo lean and avoids committing generated WASM artifacts.
Impact:
Local web setup and CI must have Rust + wasm-pack; `pkg-web` is generated on demand.
References:
`.gitignore`, `README.md`, `web/vercel.json`, `web/ARCHITECTURE.md`

### 2026-01-09: Commit web WASM package for hosted builds
Context:
Vercel builds the web app without a Rust toolchain, so `pkg-web` is missing and Vite cannot resolve
`@fork-wasm` during the build.
Decision:
Track `crates/fork_wasm/pkg-web` in git and generate it locally with
`wasm-pack build --target web --out-dir pkg-web` when core bindings change.
Why:
Keeps hosted builds working without requiring Rust/wasm-pack in the deploy environment.
Impact:
Repo now includes the web WASM artifacts; regenerate and commit after core/wasm updates.
References:
`.gitignore`, `crates/fork_wasm/pkg-web`, `web/vite.config.ts`,
`web/src/compute/worker/forkCoreWorker.ts`

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
