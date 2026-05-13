# Data-Driven Analysis Architecture

Fork now has a first vertical slice for data-driven dynamics that is deliberately shared with analytically specified systems.

## Shared Operator Layer

The first shared operator is a streaming Welch-style power spectrum accumulator in `fork_core::analysis`. It accepts scalar observable chunks from any source:

- generated Flow/Map orbit samples
- browser-selected CSV data
- future disk-backed or event-stream sources

`fork_wasm::analysis::WasmPowerSpectrumAccumulator` exposes the same accumulator to the web worker. The worker owns the compute loop and pushes batches into Rust/WASM, so the UI does not compute PSD values in TypeScript.

## Data Systems

`SystemConfig.type` now includes `data`. A Data system stores column names and a sample interval, but it does not store equations or parameters. The current UI slice attaches a local CSV file from System Settings, streams the file in the worker, pushes parsed numeric chunks into the WASM accumulator, and stores metadata plus the derived spectrum as a `dataset` object.

State Space scenes render a bounded ordered preview of the dataset rather than the PSD: one-column data appears as a time series, and multi-column data appears as a phase/state-space trajectory using the scene axes. The preview is decimated while streaming, so it stays small even when the source CSV is too large to fit in memory.

The raw local file is not serialized into Fork import/export or system snapshots. That keeps existing session archives small and avoids duplicating the existing import/export machinery. Re-attaching the file is the persistence boundary for this slice.

## Browser Storage Boundary

The existing system store continues to handle OPFS feature detection and IndexedDB fallback. Data-system metadata and derived spectra are ordinary system objects and therefore use the same persistence path. Raw disk-backed dataset handles are intentionally runtime-only in this slice; a future persistent handle layer must keep the same OPFS feature detection and IndexedDB/memory fallback rules.

## Flow/Map Reuse

Orbit objects can compute a power spectrum from their generated samples through the same client and WASM accumulator. This proves the operator layer is not dataset-only; future DMD, Koopman, delay embedding, Lyapunov-from-data, and control-probe operators should follow this source-agnostic pattern.
