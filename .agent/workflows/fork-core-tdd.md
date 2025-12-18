---
description: TDD workflow for making changes to Fork Core (Rust/WASM)
---

# Fork Core TDD Workflow

When modifying Fork Core (`crates/fork_core` or `crates/fork_wasm`), follow this test-driven development workflow.

## 1. Write Failing Tests First

Before implementing any new functionality, write Rust unit tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_feature() {
        // Define expected behavior
    }
}
```

// turbo

## 2. Run Tests to Confirm Failure

```bash
cd crates/fork_core
cargo test
```

Tests should fail, confirming the feature is not yet implemented.

## 3. Implement the Feature

Write the minimal code to make tests pass. Focus on correctness first.

## 4. Run Tests to Confirm Success

// turbo

```bash
cd crates/fork_core
cargo test
```

All tests should now pass.

## 5. Rebuild WASM Bindings

// turbo

```bash
cd crates/fork_wasm
wasm-pack build --target nodejs
```

## 6. Interactive CLI Verification

Start the CLI and test the feature end-to-end:

```bash
cd cli
npm start
```

// turbo

Navigate to the relevant functionality and verify:
- Feature works as expected
- No regressions in related features
- Error handling works correctly
- Output formatting is correct

## 7. Document and Commit

After verification passes:
- Update any relevant documentation
- Commit with descriptive message referencing what was tested
