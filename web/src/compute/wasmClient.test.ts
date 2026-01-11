import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContinuationProgress } from './ForkCoreClient'
import type { SystemConfig } from '../system/types'
import { WasmForkCoreClient } from './wasmClient'

const baseSystem: SystemConfig = {
  name: 'Test System',
  equations: ['x'],
  params: [0],
  paramNames: ['a'],
  varNames: ['x'],
  solver: 'rk4',
  type: 'flow',
}

const baseSettings = {
  step_size: 0.01,
  min_step_size: 1e-5,
  max_step_size: 0.1,
  max_steps: 10,
  corrector_steps: 4,
  corrector_tolerance: 1e-6,
  step_tolerance: 1e-6,
}

function tick() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

let lastWorker: MockWorker | null = null

class MockWorker {
  posted: unknown[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  terminate = vi.fn()

  constructor() {
    lastWorker = this
  }

  postMessage(message: unknown) {
    this.posted.push(message)
  }

  emit(message: unknown) {
    this.onmessage?.({ data: message } as MessageEvent)
  }
}

describe('WasmForkCoreClient', () => {
  beforeEach(() => {
    lastWorker = null
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts requests to the worker and resolves results', async () => {
    const client = new WasmForkCoreClient()
    const request = { system: baseSystem, initialState: [0], steps: 1, dt: 0.1 }

    const promise = client.simulateOrbit(request)
    await tick()

    expect(lastWorker).not.toBeNull()
    const [message] = lastWorker!.posted as Array<{ id: string; kind: string; payload: unknown }>
    expect(message).toMatchObject({ kind: 'simulateOrbit', payload: request })

    const result = { data: [[0, 0]], t_start: 0, t_end: 0.1, dt: 0.1 }
    lastWorker!.emit({ id: message.id, ok: true, result })

    await expect(promise).resolves.toEqual(result)
  })

  it('forwards progress updates for continuations', async () => {
    const client = new WasmForkCoreClient()
    const onProgress = vi.fn()
    const request = {
      system: baseSystem,
      equilibriumState: [0],
      parameterName: 'a',
      settings: baseSettings,
      forward: true,
    }

    const promise = client.runEquilibriumContinuation(request, { onProgress })
    await tick()

    const [message] = lastWorker!.posted as Array<{ id: string; kind: string }>
    const progress: ContinuationProgress = {
      done: false,
      current_step: 1,
      max_steps: 10,
      points_computed: 2,
      bifurcations_found: 0,
      current_param: 0.5,
    }

    lastWorker!.emit({ id: message.id, kind: 'progress', progress })
    const result = { points: [], bifurcations: [], indices: [] }
    lastWorker!.emit({ id: message.id, ok: true, result })

    await expect(promise).resolves.toEqual(result)
    expect(onProgress).toHaveBeenCalledWith(progress)
  })

  it('sends cancellation messages and rejects with AbortError', async () => {
    const client = new WasmForkCoreClient()
    const controller = new AbortController()
    const request = { system: baseSystem, initialState: [0], steps: 1, dt: 0.1 }

    const promise = client.simulateOrbit(request, { signal: controller.signal })
    await tick()

    const [message] = lastWorker!.posted as Array<{ id: string; kind: string }>
    controller.abort()
    await tick()

    expect(lastWorker!.posted).toContainEqual(
      expect.objectContaining({ id: message.id, kind: 'cancel' })
    )

    lastWorker!.emit({ id: message.id, ok: false, error: 'cancelled', aborted: true })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('terminates the worker on close', () => {
    const client = new WasmForkCoreClient()
    const worker = lastWorker!

    client.close()

    expect(worker.terminate).toHaveBeenCalled()
  })
})
