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

async function bootstrap() {
  const params = new URLSearchParams(window.location.search)
  const fixture = params.get('fixture')
  const useMock = params.has('mock') || Boolean(fixture)

  let store = new OpfsSystemStore()
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
