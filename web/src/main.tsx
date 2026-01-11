import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AppProvider } from './state/appState'
import { OpfsSystemStore } from './system/opfs'
import { MemorySystemStore, type SystemStore } from './system/store'
import { createDemoSystem } from './system/fixtures'
import { createDefaultSystems } from './system/defaultSystems'
import { WasmForkCoreClient } from './compute/wasmClient'
import { MockForkCoreClient } from './compute/mockClient'
import { JobQueue } from './compute/jobQueue'
import { enableDeterministicMode } from './utils/determinism'

const DEFAULT_SYSTEMS_SEEDED_KEY = 'fork-default-systems-seeded'

function hasSeededDefaultSystems(): boolean {
  if (typeof window === 'undefined') return false
  if (!('localStorage' in window)) return false
  if (typeof window.localStorage.getItem !== 'function') return false
  return window.localStorage.getItem(DEFAULT_SYSTEMS_SEEDED_KEY) === '1'
}

function markDefaultSystemsSeeded() {
  if (typeof window === 'undefined') return
  if (!('localStorage' in window)) return
  if (typeof window.localStorage.setItem !== 'function') return
  window.localStorage.setItem(DEFAULT_SYSTEMS_SEEDED_KEY, '1')
}

async function seedDefaultSystems(store: SystemStore) {
  if (hasSeededDefaultSystems()) return
  const existing = await store.list()
  if (existing.length === 0) {
    const defaults = createDefaultSystems()
    for (const system of defaults) {
      await store.save(system)
    }
  }
  markDefaultSystemsSeeded()
}

function registerServiceWorker(deterministic: boolean) {
  if (deterministic) return
  if (!import.meta.env.PROD) return
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return

  const register = () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((error) => {
        console.warn('[PWA] Service worker registration failed', error)
      })
  }

  if (document.readyState === 'complete') {
    register()
  } else {
    window.addEventListener('load', register, { once: true })
  }
}

async function bootstrap() {
  const params = new URLSearchParams(window.location.search)
  const deterministicFromUrl = params.has('test') || params.has('deterministic')
  const deterministicFromEnv =
    import.meta.env.VITE_DETERMINISTIC_TEST === '1' ||
    import.meta.env.VITE_DETERMINISTIC_TEST === 'true'
  const deterministic = deterministicFromUrl || deterministicFromEnv
  const fixture = params.get('fixture')
  const useMock = params.has('mock') || Boolean(fixture)

  if (deterministic) {
    // Deterministic mode keeps tests repeatable by avoiding persisted state.
    enableDeterministicMode()
    document.documentElement.dataset.deterministic = '1'
    if ('localStorage' in window && typeof window.localStorage.clear === 'function') {
      window.localStorage.clear()
    }
  }

  let store = deterministic ? new MemorySystemStore() : new OpfsSystemStore()
  if (fixture === 'demo') {
    const memory = new MemorySystemStore()
    const { system } = createDemoSystem()
    await memory.save(system)
    store = memory
  }
  if (!fixture) {
    await seedDefaultSystems(store)
  }

  const queue = new JobQueue((timing) => {
    if (import.meta.env.DEV) {
      console.info(
        `[ForkCore] ${timing.label} ${timing.status} in ${timing.durationMs.toFixed(1)}ms`
      )
    }
  })
  const client = useMock ? new MockForkCoreClient() : new WasmForkCoreClient(queue)

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProvider store={store} client={client}>
        <App />
      </AppProvider>
    </StrictMode>
  )

  registerServiceWorker(deterministic)
}

void bootstrap()
