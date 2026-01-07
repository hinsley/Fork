/// <reference lib="webworker" />

import type {
  SimulateOrbitRequest,
  SimulateOrbitResult,
  ValidateSystemRequest,
  ValidateSystemResult,
} from '../ForkCoreClient'

type WorkerRequest =
  | { id: string; kind: 'simulateOrbit'; payload: SimulateOrbitRequest }
  | { id: string; kind: 'validateSystem'; payload: ValidateSystemRequest }
  | { id: string; kind: 'cancel' }

type WorkerResponse =
  | { id: string; ok: true; result: SimulateOrbitResult | ValidateSystemResult }
  | { id: string; ok: false; error: string; aborted?: boolean }

type WasmModule = {
  WasmSystem: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    solver: string,
    systemType: string
  ) => {
    set_state: (state: Float64Array) => void
    get_state: () => Float64Array
    set_t: (t: number) => void
    get_t: () => number
    step: (dt: number) => void
  }
  default?: (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module) => Promise<void>
}

const pendingControllers = new Map<string, AbortController>()

let wasmPromise: Promise<WasmModule> | null = null

async function loadWasm(): Promise<WasmModule> {
  if (!wasmPromise) {
    wasmPromise = import('@fork-wasm').then(async (mod) => {
      if (typeof mod.default === 'function') {
        await mod.default()
      }
      return mod as WasmModule
    })
  }
  return wasmPromise
}

async function runOrbit(request: SimulateOrbitRequest, signal: AbortSignal): Promise<SimulateOrbitResult> {
  const wasm = await loadWasm()
  const system = new wasm.WasmSystem(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.solver,
    request.system.type
  )

  system.set_t(0)
  system.set_state(new Float64Array(request.initialState))

  const data: number[][] = []
  let t = 0
  data.push([t, ...request.initialState])

  for (let i = 0; i < request.steps; i += 1) {
    if (signal.aborted) {
      const error = new Error('cancelled')
      error.name = 'AbortError'
      throw error
    }
    system.step(request.dt)
    t = system.get_t()
    const state = Array.from(system.get_state())
    data.push([t, ...state])
  }

  return {
    data,
    t_start: 0,
    t_end: t,
    dt: request.dt,
  }
}

function abortIfNeeded(signal: AbortSignal) {
  if (signal.aborted) {
    const error = new Error('cancelled')
    error.name = 'AbortError'
    throw error
  }
}

async function runValidateSystem(
  request: ValidateSystemRequest,
  signal: AbortSignal
): Promise<ValidateSystemResult> {
  const wasm = await loadWasm()
  const { system } = request
  const equationErrors = system.equations.map(() => null as string | null)

  try {
    abortIfNeeded(signal)
    // Attempt full system compile first for a fast pass.
    const instance = new wasm.WasmSystem(
      system.equations,
      new Float64Array(system.params),
      system.paramNames,
      system.varNames,
      system.solver,
      system.type
    )
    void instance
    return { ok: true, equationErrors }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    for (let i = 0; i < system.equations.length; i += 1) {
      abortIfNeeded(signal)
      try {
        const instance = new wasm.WasmSystem(
          [system.equations[i]],
          new Float64Array(system.params),
          system.paramNames,
          system.varNames,
          system.solver,
          system.type
        )
        void instance
      } catch (eqErr) {
        const eqMessage = eqErr instanceof Error ? eqErr.message : String(eqErr)
        equationErrors[i] = eqMessage
      }
    }
    const hasEquationErrors = equationErrors.some((entry) => entry)
    return {
      ok: false,
      equationErrors,
      message: hasEquationErrors ? undefined : message,
    }
  }
}

const ctx = self as DedicatedWorkerGlobalScope

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.kind === 'cancel') {
    const controller = pendingControllers.get(message.id)
    if (controller) {
      controller.abort()
      pendingControllers.delete(message.id)
    }
    return
  }

  const controller = new AbortController()
  pendingControllers.set(message.id, controller)

  try {
    if (message.kind === 'simulateOrbit') {
      const result = await runOrbit(message.payload, controller.signal)
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }

    if (message.kind === 'validateSystem') {
      const result = await runValidateSystem(message.payload, controller.signal)
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    const response: WorkerResponse = {
      id: message.id,
      ok: false,
      error: error.message,
      aborted: error.name === 'AbortError',
    }
    ctx.postMessage(response)
  } finally {
    pendingControllers.delete(message.id)
  }
}
