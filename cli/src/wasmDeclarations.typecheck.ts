import type { WasmBridge } from './wasm'

type GeneratedWasmModule = typeof import('../../crates/fork_wasm/pkg/fork_wasm')
type Assert<T extends true> = T
type IsAny<T> = 0 extends 1 & T ? true : false
type ConstructorParts<T> = T extends abstract new (
  ...args: infer Arguments
) => infer Instance
  ? [Arguments, Instance]
  : never
type IsConstructable<T> = [ConstructorParts<T>] extends [never] ? false : true

type BridgeInstance = WasmBridge['instance']

export type GeneratedNodeWasmSystemIsConstructable = Assert<
  IsConstructable<GeneratedWasmModule['WasmSystem']>
>
export type WasmBridgeInstanceIsTyped = Assert<
  IsAny<BridgeInstance> extends false ? true : false
>
export type WasmBridgeStateUsesFloat64Array = Assert<
  Parameters<BridgeInstance['set_state']>[0] extends Float64Array ? true : false
>
