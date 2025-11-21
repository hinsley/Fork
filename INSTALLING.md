# Installing and Running Fork CLI

This guide describes how to build the Core system and run the Node.js CLI.

## Prerequisites

Before you begin, ensure you have the following installed:

*   **Rust**: Install via [rustup](https://rustup.rs/). You need the latest stable version (tested with 1.82.0).
*   **Node.js**: Version 18 or higher is recommended. [Download Node.js](https://nodejs.org/) (tested with v18.15.0).
*   **wasm-pack**: Required to build the WebAssembly bindings.
    ```bash
    cargo install wasm-pack
    ```

## Installation Steps

The application consists of a Rust core (compiled to WebAssembly) and a TypeScript CLI. You must build the core first.

### Step 1: Build the Core (WASM)

The CLI depends on the `fork_wasm` crate. Build it with the `nodejs` target so it can be required by the CLI.

1.  Navigate to the WASM crate directory:
    ```bash
    cd crates/fork_wasm
    ```

2.  Build the package:
    ```bash
    wasm-pack build --target nodejs
    ```
    This creates a `pkg/` directory containing the compiled WebAssembly and JavaScript bindings.

### Step 2: Install CLI Dependencies

Once the core is built, set up the CLI.

1.  Navigate to the CLI directory:
    ```bash
    cd ../../cli
    ```

2.  Install the Node.js dependencies:
    ```bash
    npm install
    ```

## Running the CLI

To start the interactive command-line interface:

```bash
npm start
```
