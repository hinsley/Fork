#!/usr/bin/env sh
set -e

export PATH="$PATH:/rust/bin:$HOME/.cargo/bin"

cd ../crates/fork_wasm
wasm-pack build --target web --out-dir pkg-web

cd ../../web
npm run build
