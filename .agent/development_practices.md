# Development Practices for Fork

This document specifies required development practices for AI agents working on the Fork codebase.

## Test-Driven Development (TDD) for Fork Core

When making modifications to **Fork Core** (`crates/fork_core` or `crates/fork_wasm`), you **MUST** follow a TDD-based approach:

1. **Write tests first**: Before implementing new functionality, write Rust unit tests that define the expected behavior.
2. **Run tests to verify failure**: Confirm the tests fail as expected before implementation.
3. **Implement the feature**: Write the minimal code to make the tests pass.
4. **Refactor**: Clean up the implementation while keeping tests green.
5. **Rebuild WASM**: After changes, rebuild with `wasm-pack build --target nodejs` in `crates/fork_wasm`.

### Test Commands

```bash
# Run Fork Core unit tests
cd crates/fork_core
cargo test

# Run all workspace tests
cargo test --workspace
```

## Interactive CLI Verification

After making changes to **Fork Core** or **Fork CLI**, you **MUST** verify the changes by actually running the Fork CLI and testing the functionality interactively.

### Why This Is Required

- Unit tests alone cannot catch integration issues between Rust/WASM and TypeScript.
- The CLI is the primary user interface; changes must work end-to-end.
- Interactive testing catches UI/UX regressions and edge cases.

### Verification Process

1. **Build the WASM** (if Fork Core was modified):
   ```bash
   cd crates/fork_wasm
   wasm-pack build --target nodejs
   ```

2. **Start the CLI**:
   ```bash
   cd cli
   npm start
   ```

3. **Test the affected functionality**:
   - Navigate to the relevant menu
   - Exercise the new or modified feature
   - Verify outputs are correct
   - Check for error handling

4. **Document results**: Note any issues found during interactive testing.

### Example Test Scenarios

- **New continuation feature**: Create a test system, run continuation, verify results in the CLI output.
- **Modified solver**: Run the solver on a known system, compare results to expected values.
- **UI changes**: Navigate through menus, verify labels and formatting are correct.

## Summary Checklist

Before considering a Fork Core or Fork CLI change complete:

- [ ] Unit tests written and passing (for Fork Core changes)
- [ ] WASM rebuilt (if Fork Core modified)
- [ ] CLI tested interactively
- [ ] Affected workflows verified end-to-end

## Code Coverage

When modifying math or solver logic in **Fork Core**, you should aim to maintain or improve test coverage.

1. **Verify Coverage Locally**: Use `cargo llvm-cov` to check coverage before pushing.
2. **Review CI Reports**: Check the Codecov report on GitHub Pull Requests to ensure new code is properly tested.
3. **Target Critical Paths**: Ensure complex algorithms (like continuation, bifurcation detection, or Jacobian calculations) have near-100% region coverage.
