declare module '@fork-wasm' {
  const init: (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module) => Promise<void>
  export const WasmSystem: unknown
  export const WasmEquilibriumRunner: unknown
  export const WasmFoldCurveRunner: unknown
  export const WasmHopfCurveRunner: unknown
  export const WasmLimitCycleRunner: unknown
  export default init
}
