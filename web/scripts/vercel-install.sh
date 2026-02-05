#!/usr/bin/env sh
set -e

export PATH="$PATH:/rust/bin:$HOME/.cargo/bin"

if ! command -v rustup >/dev/null 2>&1; then
  curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal
  if [ -f "$HOME/.cargo/env" ]; then
    . "$HOME/.cargo/env"
  fi
  export PATH="$PATH:/rust/bin:$HOME/.cargo/bin"
fi

rustup target add wasm32-unknown-unknown

if ! command -v wasm-pack >/dev/null 2>&1; then
  cargo install --locked wasm-pack
fi

npm install
