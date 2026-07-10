import type { WasmEquilibriumRunner, WasmSystem } from '@fork-wasm'

type Assert<T extends true> = T
type IsAny<T> = 0 extends 1 & T ? true : false
type ConstructorParts<T> = T extends abstract new (
  ...args: infer Arguments
) => infer Instance
  ? [Arguments, Instance]
  : never
type IsConstructable<T> = [ConstructorParts<T>] extends [never] ? false : true

type WasmSystemInstance = InstanceType<typeof WasmSystem>

export type GeneratedWasmSystemIsConstructable = Assert<IsConstructable<typeof WasmSystem>>
export type GeneratedEquilibriumRunnerIsConstructable = Assert<
  IsConstructable<typeof WasmEquilibriumRunner>
>
export type GeneratedWasmSystemInstanceIsTyped = Assert<
  IsAny<WasmSystemInstance> extends false ? true : false
>
export type GeneratedWasmSystemStateUsesFloat64Array = Assert<
  Parameters<WasmSystemInstance['set_state']>[0] extends Float64Array ? true : false
>
