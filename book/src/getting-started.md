# Getting Started

## Building

The Rust workspace builds with the standard toolchain:

```sh
cargo build          # fork_core + fork_wasm (native)
cargo test --workspace
```

The applications each manage their own bindings build:

```sh
cd cli && npm install && npm start        # CLI: builds NodeJS bindings first
cd web && npm install && npm run dev      # Web: rebuilds pkg-web packages first
```

After changing `fork_core` or `fork_wasm`, regenerate the checked-in browser
packages with `cd web && npm run wasm:web` so hosted deployments stay in sync
with sources.

## Using `fork_core` from Rust

Add the crate by path, then describe a system as equations plus named
variables and parameters:

```rust
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::{solve_equilibrium, NewtonSettings, SystemKind};

// dx/dt = y - x^3 + p,  dy/dt = x - y   (flow)
let equations = ["y - x^3 + p", "x - y"];
let variables = ["x", "y"].iter().map(|s| s.to_string()).collect::<Vec<_>>();
let parameters = ["p"].iter().map(|s| s.to_string()).collect::<Vec<_>>();

let compiler = Compiler::new(&variables, &parameters);
let bytecode = equations
    .iter()
    .map(|eq| compiler.compile(&parse(eq).unwrap()))
    .collect();
let mut system = EquationSystem::new(bytecode, vec![0.5]);
system.set_maps(compiler.param_map, compiler.var_map);

let root =
    solve_equilibrium(&system, SystemKind::Flow, &[0.5, 0.5], NewtonSettings::default())
        .unwrap();
println!("equilibrium at {:?}", root.state);
```

Everything the engine produces that crosses a process boundary — branches,
points, diagnostics — is plain serde data. The same structures serialize to
the browser unchanged.

## Where to go next

- [From Equilibrium to an LPC Curve](tutorial-lpc.md) drives a complete
  continuation workflow from code.
- The generated API reference lives under `api/` on the deployed documentation
  site, or run `cargo doc --open` locally.
