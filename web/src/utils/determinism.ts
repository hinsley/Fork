type DeterministicOptions = {
  seed?: number
  epochMs?: number
  epochStepMs?: number
  perfStepMs?: number
}

const DEFAULT_SEED = 0x3c6ef35f
const DEFAULT_EPOCH_MS = Date.parse('2024-01-01T00:00:00.000Z')
const DEFAULT_EPOCH_STEP_MS = 1000
const DEFAULT_PERF_STEP_MS = 1

type DeterministicState = {
  enabled: boolean
  seed: number
  epochMs: number
  epochStepMs: number
  perfMs: number
  perfStepMs: number
  idCounters: Map<string, number>
}

const state: DeterministicState = {
  enabled: false,
  seed: DEFAULT_SEED,
  epochMs: DEFAULT_EPOCH_MS,
  epochStepMs: DEFAULT_EPOCH_STEP_MS,
  perfMs: 0,
  perfStepMs: DEFAULT_PERF_STEP_MS,
  idCounters: new Map(),
}

/**
 * Enable deterministic mode for tests and external harnesses.
 * This stabilizes ID generation, time, and randomness so UI state is repeatable.
 */
export function enableDeterministicMode(options?: DeterministicOptions) {
  state.enabled = true
  state.seed = options?.seed ?? DEFAULT_SEED
  state.epochMs = options?.epochMs ?? DEFAULT_EPOCH_MS
  state.epochStepMs = options?.epochStepMs ?? DEFAULT_EPOCH_STEP_MS
  state.perfMs = 0
  state.perfStepMs = options?.perfStepMs ?? DEFAULT_PERF_STEP_MS
  state.idCounters.clear()
}

export function isDeterministicMode() {
  return state.enabled
}

/**
 * Deterministic RNG for stable IDs and other test-time randomness.
 */
export function nextRandom(): number {
  if (!state.enabled) return Math.random()
  state.seed = (state.seed * 1664525 + 1013904223) % 0x1_0000_0000
  return state.seed / 0x1_0000_0000
}

function randomSuffix(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Generate a stable ID when deterministic mode is on.
 */
export function makeStableId(prefix: string) {
  if (!state.enabled) return `${prefix}_${randomSuffix()}`
  const next = (state.idCounters.get(prefix) ?? 0) + 1
  state.idCounters.set(prefix, next)
  return `${prefix}_${String(next).padStart(4, '0')}`
}

/**
 * Deterministic wall-clock time for system timestamps.
 */
export function nowEpochMs(): number {
  if (!state.enabled) return Date.now()
  const value = state.epochMs
  state.epochMs += state.epochStepMs
  return value
}

export function nowIso(): string {
  return new Date(nowEpochMs()).toISOString()
}

/**
 * Deterministic performance timing for job queue metrics.
 */
export function nowPerfMs(): number {
  if (!state.enabled) {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now()
    }
    return Date.now()
  }
  const value = state.perfMs
  state.perfMs += state.perfStepMs
  return value
}
