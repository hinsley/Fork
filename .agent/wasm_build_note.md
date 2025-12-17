# WASM Build Requirements

When developing the Fork CLI, if you make changes to `crates/fork_core` or `crates/fork_wasm`, you **MUST** rebuild the WASM bindings using `wasm-pack`.

Standard `cargo build` is **NOT SUFFICIENT** because the CLI loads the compiled WASM and JS glue code from the `crates/fork_wasm/pkg` directory, which is only generated/updated by `wasm-pack`.

## Build Command

Run the following in `crates/fork_wasm`:

```bash
wasm-pack build --target nodejs
```

Failure to do this will result in the CLI using stale WASM code, leading to confusing bugs where logic changes in Rust do not appear to take effect in the CLI.
