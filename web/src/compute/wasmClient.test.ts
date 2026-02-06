import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ComputeIsoclineRequest,
  ContinuationProgress,
  EquilibriumContinuationRequest,
  LyapunovExponentsRequest,
  SimulateOrbitRequest,
} from './ForkCoreClient'
import type { SystemConfig } from '../system/types'
import { WasmForkCoreClient } from './wasmClient'
import { enableDeterministicMode } from '../utils/determinism'

type WorkerMessage = Record<string, unknown>

class MockWorker {
  static instances: MockWorker[] = []
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null
  posted: WorkerMessage[] = []
  terminated = false
  url: string | URL
  options?: WorkerOptions

  constructor(url: string | URL, options?: WorkerOptions) {
    this.url = url
    this.options = options
    MockWorker.instances.push(this)
  }

  postMessage = (message: WorkerMessage) => {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }

  emit(message: WorkerMessage) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>)
  }
}

function flushQueue() {
  return new Promise<void>((resolve) => {
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(resolve)
    } else {
      setTimeout(resolve, 0)
    }
  })
}

const baseSystem: SystemConfig = {
  name: 'Test System',
  equations: ['x'],
  params: [],
  paramNames: [],
  varNames: ['x'],
  solver: 'rk4',
  type: 'flow',
}

const continuationSettings = {
  step_size: 0.01,
  min_step_size: 0.001,
  max_step_size: 0.1,
  max_steps: 10,
  corrector_steps: 4,
  corrector_tolerance: 1e-6,
  step_tolerance: 1e-6,
}

describe('WasmForkCoreClient', () => {
  beforeEach(() => {
    enableDeterministicMode()
    MockWorker.instances = []
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends worker requests and resolves results', async () => {
    const client = new WasmForkCoreClient()
    const request: SimulateOrbitRequest = {
      system: baseSystem,
      initialState: [0],
      steps: 1,
      dt: 0.1,
    }
    const promise = client.simulateOrbit(request)

    await flushQueue()
    const worker = MockWorker.instances[0]
    expect(worker).toBeDefined()
    expect(worker.posted).toHaveLength(1)
    const message = worker.posted[0]
    expect(message).toMatchObject({ kind: 'simulateOrbit', payload: request })
    expect(message.id).toBe('req_0001')

    const result = {
      data: [[0, 0]],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
    }
    worker.emit({ id: message.id, ok: true, result })

    await expect(promise).resolves.toEqual(result)

    await client.close()
    expect(worker.terminated).toBe(true)
  })

  it('forwards progress updates for continuation jobs', async () => {
    const client = new WasmForkCoreClient()
    const onProgress = vi.fn()
    const request: EquilibriumContinuationRequest = {
      system: baseSystem,
      equilibriumState: [0],
      parameterName: 'p1',
      settings: continuationSettings,
      forward: true,
    }

    const promise = client.runEquilibriumContinuation(request, { onProgress })
    await flushQueue()

    const worker = MockWorker.instances[0]
    const message = worker.posted[0]
    expect(message).toMatchObject({ kind: 'runEquilibriumContinuation', payload: request })

    const progress: ContinuationProgress = {
      done: false,
      current_step: 0,
      max_steps: 10,
      points_computed: 0,
      bifurcations_found: 0,
      current_param: 0,
    }

    worker.emit({ id: message.id, kind: 'progress', progress })
    const result = { points: [], bifurcations: [], indices: [] }
    worker.emit({ id: message.id, ok: true, result })

    await expect(promise).resolves.toEqual(result)
    expect(onProgress).toHaveBeenCalledWith(progress)
  })

  it('maps aborted worker responses to AbortError', async () => {
    const client = new WasmForkCoreClient()
    const request: LyapunovExponentsRequest = {
      system: baseSystem,
      startState: [0],
      startTime: 0,
      steps: 1,
      dt: 0.1,
      qrStride: 1,
    }

    const promise = client.computeLyapunovExponents(request)
    await flushQueue()

    const worker = MockWorker.instances[0]
    const message = worker.posted[0]
    worker.emit({ id: message.id, ok: false, error: 'cancelled', aborted: true })

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('sends computeIsocline requests and resolves geometry', async () => {
    const client = new WasmForkCoreClient()
    const request: ComputeIsoclineRequest = {
      system: {
        ...baseSystem,
        equations: ['x + y', 'x - y'],
        varNames: ['x', 'y'],
      },
      expression: 'x + y',
      level: 0,
      axes: [
        { variableName: 'x', min: -2, max: 2, samples: 16 },
        { variableName: 'y', min: -2, max: 2, samples: 16 },
      ],
      frozenState: [0, 0],
    }

    const promise = client.computeIsocline(request)
    await flushQueue()

    const worker = MockWorker.instances[0]
    const message = worker.posted[0]
    expect(message).toMatchObject({ kind: 'computeIsocline', payload: request })

    const result = {
      geometry: 'segments' as const,
      dim: 2,
      points: [0, 0, 1, 1],
      segments: [0, 1],
    }
    worker.emit({ id: message.id, ok: true, result })

    await expect(promise).resolves.toEqual(result)
  })
})
