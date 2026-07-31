#!/usr/bin/env sh
set -e

export PATH="$PATH:/rust/bin:$HOME/.cargo/bin"

npm run build
