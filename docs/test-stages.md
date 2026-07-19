# Test stages

Fork keeps its most expensive numerical and browser regressions out of the
default edit-test loop without dropping coverage. Run stages from the repository
root:

```sh
node scripts/test-stage.mjs fast
node scripts/test-stage.mjs medium
node scripts/test-stage.mjs full
node scripts/test-stage.mjs profile
```

## Fast

Runs the non-ignored Rust workspace tests and doctests, CLI unit/menu tests, and
all Vitest files in parallel. It does not build WASM, run production builds, or
start a browser.

## Medium

Runs `fast`, then the 28 deferred numerical regressions, prepared Node-WASM
smoke, prepared web/CLI builds, and the mocked and real-WASM Playwright projects.
Prepare each target once before running it directly:

```sh
npm --prefix cli run prepare:wasm
npm --prefix web run prepare:wasm
node scripts/test-stage.mjs medium
```

The Node and web WASM builds use separate Cargo target directories. Commands
ending in `:prepared` never invoke `wasm-pack`.

## Full

Runs `medium`, the split manifold and generalized-period-doubling benchmarks,
the published cycle references in release mode, and Rust/web/CLI coverage. Full
Rust coverage also uses the release profile so every ignored numerical and
published reference test is included in one workspace-level coverage run.
Install `cargo-nextest` and `cargo-llvm-cov` before running this stage locally.

## Profile

Prepares each WASM target once, profiles Rust with Nextest JUnit output, profiles
Vitest and both Playwright projects with JSON output, times the CLI cohorts, and
writes ranked per-layer Pareto tables to the ignored
`target/test-timings/pareto.md` and `pareto.json` files. The table includes each
test's module/file, duration, percentage, cumulative percentage, and the cases
needed to reach 80% of measured time.

If a late browser cohort fails after the longer Rust profile has completed,
rerun it with `TEST_PROFILE_RESUME=1` to reuse the existing Rust, Vitest, and
CLI data while refreshing both browser cohorts and the final report.

The tier inventory lives in `scripts/test-inventory.mjs`. Moving a Rust test
between stages requires changing both its `#[ignore]` annotation and that
inventory so local runs, profiling, scheduled validation, and CI stay aligned.
