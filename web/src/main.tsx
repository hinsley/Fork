import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AppProvider } from './state/appState'
import { MemorySystemStore, type SystemStore } from './system/store'
import {
  CODIM2_GH_E2E_FIXTURE,
  HOMOCLINIC_PRODUCT_E2E_FIXTURE,
  HOMOCLINIC_PRODUCT_E2E_SYSTEM_NAME,
  HomoclinicProductE2EClient,
  createAxisPickerMapSystem,
  createAxisPickerSystem,
  createCodim2GeneralizedHopfE2ESystem,
  createDemoSystem,
  createHomoclinicProductE2ESystem,
  createLimitCycleManifoldSystem,
  createPeriodDoublingSystem,
} from './system/fixtures'
import { createBrowserSystemStore } from './system/storeFactory'
import { WasmForkCoreClient } from './compute/wasmClient'
import { MockForkCoreClient } from './compute/mockClient'
import { JobQueue } from './compute/jobQueue'
import { enableDeterministicMode } from './utils/determinism'

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
  const useRealWasmFixture = import.meta.env.DEV && fixture === CODIM2_GH_E2E_FIXTURE
  const useMock = params.has('mock') || (Boolean(fixture) && !useRealWasmFixture)
  const useHomoclinicProductFixture =
    import.meta.env.DEV && fixture === HOMOCLINIC_PRODUCT_E2E_FIXTURE

  if (deterministic) {
    // Deterministic mode keeps tests repeatable by avoiding persisted state.
    enableDeterministicMode()
    document.documentElement.dataset.deterministic = '1'
    if ('localStorage' in window && typeof window.localStorage.clear === 'function') {
      window.localStorage.clear()
    }
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
  } else if (useRealWasmFixture) {
    const memory = new MemorySystemStore()
    await memory.save(createCodim2GeneralizedHopfE2ESystem().system)
    store = memory
  } else if (useHomoclinicProductFixture) {
    // Unlike the in-memory visual fixtures, this product fixture deliberately
    // uses browser storage so its create/extend results can be verified after
    // reload. Session storage prevents the reload itself from reseeding it.
    const selection = await createBrowserSystemStore({
      deterministic: false,
      warnOnMemory: false,
    })
    store = selection.store
    initialError = selection.warning
    const seededThisTab = window.sessionStorage.getItem(HOMOCLINIC_PRODUCT_E2E_FIXTURE) === '1'
    if (!seededThisTab) {
      const existing = (await store.list()).filter(
        (system) => system.name === HOMOCLINIC_PRODUCT_E2E_SYSTEM_NAME
      )
      for (const system of existing) await store.remove(system.id)
      await store.save(createHomoclinicProductE2ESystem().system)
      window.sessionStorage.setItem(HOMOCLINIC_PRODUCT_E2E_FIXTURE, '1')
    }
  } else {
    const selection = await createBrowserSystemStore({
      deterministic,
      warnOnMemory: !deterministic,
    })
    store = selection.store
    initialError = selection.warning
  }

  const queue = new JobQueue((timing) => {
    if (import.meta.env.DEV) {
      console.info(
        `[ForkCore] ${timing.label} ${timing.status} in ${timing.durationMs.toFixed(1)}ms`
      )
    }
  })
  const client =
    useHomoclinicProductFixture
      ? new HomoclinicProductE2EClient()
      : useMock
        ? new MockForkCoreClient()
        : new WasmForkCoreClient(queue)

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProvider store={store} client={client} initialError={initialError}>
        <App />
      </AppProvider>
    </StrictMode>
  )

  registerServiceWorker(deterministic)
}

void bootstrap()
