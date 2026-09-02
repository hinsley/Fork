#!/usr/bin/env bash
# Benchmark harness for 2D stable/unstable manifold computation of flow
# equilibria (fork_core `continue_manifold_eq_2d` / `extend_manifold_eq_2d`).
#
# Builds the deterministic benchmark example in release mode, runs it against
# the committed numeric baselines, and prints METRIC lines:
#   METRIC manifold_eq_2d_seconds=<total timed seconds>   (primary)
#   METRIC lorenz_stable_seconds / rossler_unstable_seconds
#   METRIC numerics_max_abs_diff / vertices_total / rings_total
# Exits 0 on success, 1 on numerics/structure drift or missing baseline,
# 2 on computation failure. Tunables: MANIFOLD_BENCH_TOL (default 1e-7),
# MANIFOLD_BENCH_BASELINES (dir).

set -euo pipefail

cd "$(dirname "$0")"

# Rust toolchain lives under ~/.cargo and is not on the default PATH here.
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi

# This host has no C compiler/linker (no cc/gcc/clang binaries), so linking
# goes through a wrapper that drives the rustc-bundled rust-lld with the
# system gnu CRT objects and explicit library paths. Bootstrap it idempotently.
LIBS_DIR="$HOME/.local/share/fork-rust-libs"
mkdir -p "$LIBS_DIR"

if [ ! -e "$LIBS_DIR/libgcc_s.so" ]; then
  # Only libgcc_s.so.1 is installed; lld needs the unversioned name for -lgcc_s.
  ln -s /usr/lib/x86_64-linux-gnu/libgcc_s.so.1 "$LIBS_DIR/libgcc_s.so"
fi

if [ ! -x "$LIBS_DIR/rust-lld-crt.sh" ]; then
cat > "$LIBS_DIR/rust-lld-crt.sh" <<'WRAPPER'
#!/bin/bash
# Linker wrapper for hosts without a C toolchain. rustc invokes custom
# linkers with gcc-driver-style arguments (-Wl,..., -m64, -B<dir>); this
# translates them and feeds the rustc-bundled rust-lld, sandwiching the
# system gnu CRT objects (Scrt1/crti/crtn) around the input objects.
# Scrt1 is skipped for shared libraries: its _start references `main`, which
# would leave an undefined symbol in proc-macro dylibs and break dlopen.
LIBDIR=/usr/lib/x86_64-linux-gnu
SHIM="$(dirname "$(readlink -f "$0")")"
if command -v rustc >/dev/null 2>&1; then
  SYSROOT=$(rustc --print sysroot)
else
  SYSROOT="$HOME/.rustup/toolchains/stable-x86_64-unknown-linux-gnu"
fi
LLD="$SYSROOT/lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld"

# Pass 1: translate gcc-driver arguments into lld arguments.
translated=()
for a in "$@"; do
  case "$a" in
    -Wl,*)
      IFS=',' read -ra parts <<< "${a#-Wl,}"
      translated+=("${parts[@]}")
      continue
      ;;
    -m64|-nodefaultlibs)
      continue
      ;;
    -B/*)   # rustc's gcc-ld search dir; we call rust-lld directly.
      continue
      ;;
  esac
  translated+=("$a")
done

is_shared=false
for a in "${translated[@]}"; do
  if [[ "$a" == "-shared" ]]; then is_shared=true; fi
done

# Pass 2: insert CRT objects (crti after first object, crtn before -o).
args=()
seen_first_obj=false
for a in "${translated[@]}"; do
  if [[ "$a" == "-o" ]]; then
    args+=("$LIBDIR/crtn.o")
  fi
  if ! $seen_first_obj && [[ "$a" == *.o ]]; then
    if ! $is_shared; then
      args+=("$LIBDIR/Scrt1.o")
    fi
    args+=("$LIBDIR/crti.o")
    seen_first_obj=true
  fi
  args+=("$a")
done

exec "$LLD" -flavor gnu \
  --dynamic-linker=/lib64/ld-linux-x86-64.so.2 \
  "-L$LIBDIR" "-L$SHIM" \
  "${args[@]}"
WRAPPER
chmod +x "$LIBS_DIR/rust-lld-crt.sh"
fi

export RUSTFLAGS="-C linker=$LIBS_DIR/rust-lld-crt.sh"

cargo build --release --features parallel --example manifold_eq_2d_bench -p fork_core

exec target/release/examples/manifold_eq_2d_bench
