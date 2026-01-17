# Repository Guidelines

## Project Structure & Module Organization
Fork is a monorepo with a Rust/WASM core and a web/CLI interface.
- `crates/fork_core`: core math engine (parsing, integration, continuation).
- `crates/fork_wasm`: WASM bindings consumed by the CLI and web.
- `cli`: TypeScript Node.js CLI (interactive menus).
- `web`: Vite + React frontend.
- `docs/`: design/analysis notes; `docs/DECISIONS.md` is the design decision log; `scripts/`: utility scripts.

## Build, Test, and Development Commands
- `cargo build`: build Rust workspace.
- `cargo test --workspace`: run all Rust tests.
- `cd crates/fork_wasm && wasm-pack build --target nodejs`: rebuild WASM bindings for the CLI.
- `cd cli && npm install` then `npm start`: install deps and run the CLI.
- `cd cli && npm run build`: compile the CLI TypeScript.
- `cd web && npm install` then `npm run dev`: run the web app locally.
- `cd web && npm run build`: production build; `npm run lint`: lint TS/React; `npm run preview`: preview build.

## Coding Style & Naming Conventions
- Rust: follow `rustfmt` defaults; `snake_case` for functions/modules, `CamelCase` for types.
- TypeScript/React: 2-space indentation per `.editorconfig`, `camelCase` for variables/functions, `PascalCase` for components.
- Linting: `web` uses ESLint (`.eslintrc.cjs`); keep warnings clean.

## Testing Guidelines
- Rust tests live alongside modules in `crates/**` using `#[cfg(test)] mod tests`.
- For `crates/fork_core` or `crates/fork_wasm`, follow TDD: write failing tests first, then implement.
- After core/WASM changes, rebuild WASM and verify end-to-end via the CLI (`npm start`).
- For math/solver changes, check coverage with `cargo llvm-cov` when possible.

## Commit & Pull Request Guidelines
- Commit messages are mostly conventional (`feat:`, `fix:`, `chore:`) with occasional scopes (`feat(codim1-curves): ...`); use imperative, descriptive summaries.
- PRs should include a short summary, test commands run, and note any WASM rebuilds; include screenshots for UI changes and link relevant issues.

## Agent-Specific Instructions
If you touch `crates/fork_core`, `crates/fork_wasm`, or `cli`, you must rebuild WASM (`wasm-pack build --target nodejs`) and validate behavior interactively in the CLI.
Update `web/docs/plotly-injections.md` whenever Plotly touchpoints are added or removed.
OPFS is Chromium-only (Safari/Firefox lack `FileSystemFileHandle.createWritable`), so any work that
touches web persistence, import/export, or file handles must feature-detect OPFS and provide/verify
the IndexedDB fallback (memory if IndexedDB is unavailable); do not assume OPFS in tests or docs.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
- Use 'bd' for task tracking
