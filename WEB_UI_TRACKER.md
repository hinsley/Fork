# Web UI Tracker

Checklist for the Fork web UI buildout. Items checked are completed; unchecked are pending or partial.

## A) Repo Inspection + Architecture Docs
- [x] Inspect repo layout (CLI, web, core, tooling, TS/JS conventions)
- [x] Document how CLI calls Fork Core and CLI surface area
- [x] Choose minimal web stack consistent with repo
- [x] Create `web/ARCHITECTURE.md` with module boundaries, data model, concurrency plan, parity strategy

## B) Non-negotiable Constraints
- [x] All computations orchestrated via Fork Core (WASM) and ForkCoreClient
- [x] Plotly.js used for all 2D/3D graphics (initially)
- [x] Panel-based UI; fixed layout (no global scroll)
- [ ] Full CLI feature parity (target; still in progress)
- [x] Async compute pipeline with cancellation via job queue / AbortController
- [x] Main-thread responsiveness preserved (worker + async calls)
- [ ] Co-design new Plotly interaction patterns before implementation
- [ ] Rich interaction for bifurcation/state-space (selection linking, brushing, camera sync) – pending design
- [x] Prototype-first for new visualization features (placeholder bifurcation view)

## C) UX / Product Requirements (v0)
- [x] Systems treated as projects; create/open/save/export/import
- [x] Objects tree with hierarchy, rename, reorder, visibility
- [x] Non-state-space nodes supported (scene + bifurcation diagram viewports)
- [x] Inspector panel bound to selection; render controls included
- [x] Branch viewer panel wired to state (read-only ok)

## D) Performance Engineering
- [x] Job queue for WASM calls with cancellation support
- [x] Dev instrumentation for compute timings + hitch overlay
- [ ] Measured perf targets / budgets tracked in docs

## E) Testing (TDD-first)
- [x] Unit tests (model, selection, visibility, job queue, cancellation)
- [x] Component/integration tests (Objects tree, Inspector, panel resize)
- [x] E2E smoke test (create system → create object → inspector update → viewport renders → branches view)
- [x] One-command test run (`npm test`)
- [x] ForkCoreClient interface mockable + DI wired for tests
- [x] Stable selectors via `data-testid`
- [ ] CI configured to run tests on regressions

## F) Optional External Agent Harness
- [ ] Deterministic test mode + external browser-driving harness
- [ ] Headed Chrome instructions (Playwright headed / inspector)

## G) Minimal Vertical Slice (Must Run)
- [x] System creation/opening persisted in OPFS
- [x] Objects tree interactions (create/select/rename/toggle visibility)
- [x] Inspector panel bound to selection
- [x] Plotly viewport panel wired via ForkCoreClient
- [x] Branch Viewer panel wired to state (read-only ok)
- [x] Export/import full system bundle
- [x] Tests covering the slice

## H) Output + Next Steps
- [x] `web/ARCHITECTURE.md`
- [x] `web/TESTING.md`
- [x] Next steps to reach CLI parity (explicit list)

### Next Steps to Reach CLI Parity (Ordered by ROI)
1. Wire core solve flows: equilibrium solve, orbit extend, and continuation runs via ForkCoreClient (async + cancellable).
2. Flesh out Branch Viewer details/actions (point browser, bifurcation metadata, create branches from points).
3. Co-design and implement bifurcation + state-space interaction links (selection sync, hover, brushing, camera sync).
4. Implement missing object workflows (limit cycle solve/continue, Lyapunov/CLV analysis, branch extend/rename/delete).
5. Align persistence with CLI formats (import/export compatibility checks + migration notes).

## Additional Work Completed
- [x] Multi-viewport workspace (scenes + bifurcation diagrams) with drag reorder
- [x] Context menu for Objects tree (rename, delete)
- [x] Unity-like dark theme + theme toggle
- [x] Per-panel viewport height resize handle
- [x] Plotly lazy-load + resize observer
