import { useEffect, useMemo, useState } from 'react'
import type { ForkCoreClient } from '../compute/ForkCoreClient'
import { AppProvider } from '../state/appState'
import { MemorySystemStore } from '../system/store'
import type { System } from '../system/types'
import { EmbedViewportStack } from './EmbedViewportStack'
import {
  EMBED_PROTOCOL_VERSION,
  normalizeEmbedSpec,
  type EmbedInitMessage,
  type EmbedPortMessage,
  type EmbedSpecV1,
} from './types'

type Runtime = {
  system: System
  store: MemorySystemStore
  spec: EmbedSpecV1
}

function nonceFromLocation(): string {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return params.get('nonce') ?? ''
}

function parseArchive(archive: ArrayBuffer): Promise<System> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./archiveWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      worker.terminate()
      if (event.data?.ok) resolve(event.data.system as System)
      else reject(new Error(event.data?.error || 'Unable to read system archive.'))
    }
    worker.onerror = () => {
      worker.terminate()
      reject(new Error('Unable to start the system archive reader.'))
    }
    worker.postMessage({ archive }, [archive])
  })
}

export function EmbedRoot({ client }: { client: ForkCoreClient }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [status, setStatus] = useState('Waiting for system archive…')
  const [error, setError] = useState<string | null>(null)
  const nonce = useMemo(() => nonceFromLocation(), [])

  useEffect(() => {
    let initialized = false
    const handleMessage = (event: MessageEvent<EmbedInitMessage>) => {
      const message = event.data
      if (initialized || event.source !== window.parent) return
      if (
        !message ||
        message.type !== 'fork-embed:init' ||
        message.version !== EMBED_PROTOCOL_VERSION ||
        message.nonce !== nonce ||
        !(message.archive instanceof ArrayBuffer)
      ) {
        return
      }
      initialized = true
      const port = event.ports[0]
      const send = (payload: EmbedPortMessage) => port?.postMessage(payload)
      port?.start()
      setStatus('Reading system archive…')
      void parseArchive(message.archive)
        .then(async (system) => {
          const store = new MemorySystemStore()
          await store.save(system)
          setRuntime({ system, store, spec: normalizeEmbedSpec(message.spec) })
          send({ type: 'fork-embed:loaded', systemName: system.name })
        })
        .catch((reason) => {
          const messageText = reason instanceof Error ? reason.message : String(reason)
          setError(messageText)
          send({ type: 'fork-embed:error', message: messageText })
        })
    }

    window.addEventListener('message', handleMessage)
    window.parent.postMessage(
      {
        type: 'fork-embed:ready',
        version: EMBED_PROTOCOL_VERSION,
        nonce,
      },
      '*'
    )
    return () => window.removeEventListener('message', handleMessage)
  }, [nonce])

  if (error) return <div className="embed-status embed-status--error" role="alert">{error}</div>
  if (!runtime) return <div className="embed-status" role="status">{status}</div>

  return (
    <AppProvider
      key={runtime.system.id}
      store={runtime.store}
      client={client}
      initialSystem={runtime.system}
      initialSystems={[
        {
          id: runtime.system.id,
          name: runtime.system.name,
          type: runtime.system.config.type,
          updatedAt: runtime.system.updatedAt,
        },
      ]}
    >
      <EmbedViewportStack spec={runtime.spec} applyDocumentTheme />
    </AppProvider>
  )
}
