import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AppProvider } from './state/appState'
import { MemorySystemStore, type SystemStore } from './system/store'
import {
  createAxisPickerMapSystem,
  createAxisPickerSystem,
  createDemoSystem,
  createLimitCycleManifoldSystem,
  createPeriodDoublingSystem,
} from './system/fixtures'
import { createBrowserSystemStore } from './system/storeFactory'
import { WasmForkCoreClient } from './compute/wasmClient'
import { MockForkCoreClient } from './compute/mockClient'
import { JobQueue } from './compute/jobQueue'
import { enableDeterministicMode } from './utils/determinism'
import { EmbedRoot } from './embed/EmbedRoot'
import { createReadOnlyEmbedClient } from './embed/readOnlyClient'

function registerServiceWorker(deterministic: boolean, embedMode: boolean) {
  if (deterministic || embedMode) return
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
  const embedMode = window.location.pathname === '/embed'
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
    if (
      !embedMode &&
      'localStorage' in window &&
      typeof window.localStorage.clear === 'function'
    ) {
      window.localStorage.clear()
    }
  }

  const queue = new JobQueue((timing) => {
    if (import.meta.env.DEV) {
      console.info(
        `[ForkCore] ${timing.label} ${timing.status} in ${timing.durationMs.toFixed(1)}ms`
      )
    }
  })
  const client = useMock ? new MockForkCoreClient() : new WasmForkCoreClient(queue)

  if (embedMode) {
    document.documentElement.dataset.embed = '1'
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <EmbedRoot client={createReadOnlyEmbedClient(client)} />
      </StrictMode>
    )
    return
  }

  let store: SystemStore
  let initialError: string | null = null
  if (fixture === 'demo') {
    const memory = new MemorySystemStore()
    const { system } = createDemoSystem()
    await memory.save(system)
    store = memory
  } else if (fixture === 'pd') {
    const memory = new MemorySystemStore()
    const { system } = createPeriodDoublingSystem()
    await memory.save(system)
    store = memory
  } else if (fixture === 'lc-manifold') {
    const memory = new MemorySystemStore()
    const { system } = createLimitCycleManifoldSystem()
    await memory.save(system)
    store = memory
  } else if (fixture === 'axis-picker') {
    const memory = new MemorySystemStore()
    const { system } = createAxisPickerSystem()
    await memory.save(system)
    store = memory
  } else if (fixture === 'axis-picker-map') {
    const memory = new MemorySystemStore()
    const { system } = createAxisPickerMapSystem()
    await memory.save(system)
    store = memory
  } else {
    const selection = await createBrowserSystemStore({
      deterministic,
      warnOnMemory: !deterministic,
    })
    store = selection.store
    initialError = selection.warning
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProvider store={store} client={client} initialError={initialError}>
        <App />
      </AppProvider>
    </StrictMode>
  )

  registerServiceWorker(deterministic, embedMode)
}

void bootstrap()
