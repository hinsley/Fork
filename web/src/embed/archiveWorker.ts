/// <reference lib="webworker" />

import { EMBED_ARCHIVE_LIMITS, parseSystemArchiveBytes } from '../system/archive'

type ArchiveWorkerRequest = { archive: ArrayBuffer }

self.onmessage = (event: MessageEvent<ArchiveWorkerRequest>) => {
  try {
    const system = parseSystemArchiveBytes(new Uint8Array(event.data.archive), {
      limits: EMBED_ARCHIVE_LIMITS,
      strict: true,
    })
    self.postMessage({ ok: true, system })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ ok: false, error: message })
  }
}
