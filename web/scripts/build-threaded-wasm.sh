#!/usr/bin/env sh
set -e

export RUSTUP_TOOLCHAIN=nightly-2025-11-15
export CARGO_UNSTABLE_BUILD_STD='panic_abort,std'
export RUSTFLAGS='-C target-feature=+atomics,+bulk-memory -C link-arg=--shared-memory -C link-arg=--max-memory=1073741824 -C link-arg=--import-memory -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base'

cd ../crates/fork_wasm
wasm-pack build --target web --out-dir pkg-web-threads --features wasm-threads
