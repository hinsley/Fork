---
description: How to check test coverage for Fork Core
---

# Fork Core Coverage Workflow

Follow this workflow to verify test coverage for Fork Core logic.

## 1. Install Tools (If missing)

```bash
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov
```

## 2. Run Local Coverage

Run coverage for the entire workspace and view the summary in the terminal:

// turbo
```bash
cargo llvm-cov
```

## 3. Detailed HTML Report

To see exactly which lines and branches are covered, generate an HTML report:

```bash
cargo llvm-cov --html --open
```

This will open your default browser with a searchable, interactive report.

## 4. Coverage for Specific Crate

To run coverage only for `fork_core`:

// turbo
```bash
cargo llvm-cov -p fork_core
```

## 5. Requirements

- **Aim for no regressions**: Ensure that new features don't lower the overall project coverage percentage.
- **Cover Edge Cases**: Use the HTML report to identify unexecuted error paths or branch conditions.
- **Math Logic**: Any new mathematical formula or solver adjustment **MUST** be covered by unit tests.
