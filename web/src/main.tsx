import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AppProvider } from './state/appState'
import { OpfsSystemStore } from './system/opfs'
import { MemorySystemStore } from './system/store'
import { createDemoSystem } from './system/fixtures'
import { WasmForkCoreClient } from './compute/wasmClient'
import { MockForkCoreClient } from './compute/mockClient'
import { JobQueue } from './compute/jobQueue'
import { enableDeterministicMode } from './utils/determinism'

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
}

void bootstrap()
