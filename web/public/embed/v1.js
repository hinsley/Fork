(function () {
  'use strict'

  const VERSION = 1
  const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024
  const scriptUrl = new URL(document.currentScript && document.currentScript.src ? document.currentScript.src : window.location.href)
  const viewerOrigin = scriptUrl.origin
  const viewerUrl = new URL('/embed', viewerOrigin)

  function nonce() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  function list(value) {
    return [...new Set((value || '').split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean))]
  }

  async function readBounded(response) {
    if (!response.ok) {
      throw new Error(`System archive request failed (${response.status}).`)
    }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_COMPRESSED_BYTES) {
      throw new Error('System archive is larger than the 64 MiB embed limit.')
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength > MAX_COMPRESSED_BYTES) {
        throw new Error('System archive is larger than the 64 MiB embed limit.')
      }
      return buffer
    }
    const reader = response.body.getReader()
    const chunks = []
    let length = 0
    while (true) {
      const result = await reader.read()
      if (result.done) break
      length += result.value.byteLength
      if (length > MAX_COMPRESSED_BYTES) {
        await reader.cancel()
        throw new Error('System archive is larger than the 64 MiB embed limit.')
      }
      chunks.push(result.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes.buffer
  }

  class ForkEmbedElement extends HTMLElement {
    static get observedAttributes() {
      return ['src', 'viewports', 'theme', 'headers', 'interaction', 'controls']
    }

    constructor() {
      super()
      this._runId = 0
      this._shadow = this.attachShadow({ mode: 'open' })
    }

    connectedCallback() {
      if (!this.style.display) this.style.display = 'block'
      if (!this.style.width) this.style.width = '100%'
      if (!this.style.height) this.style.height = '480px'
      this._start()
    }

    attributeChangedCallback() {
      if (this.isConnected) this._start()
    }

    disconnectedCallback() {
      this._runId += 1
    }

    _spec() {
      const theme = this.getAttribute('theme')
      const headers = this.getAttribute('headers')
      const interaction = this.getAttribute('interaction')
      const controlsAttribute = this.getAttribute('controls')
      const controls = list(controlsAttribute).filter(
        (entry) => entry === 'reset' || entry === 'fullscreen'
      )
      return {
        version: VERSION,
        viewportIds: list(this.getAttribute('viewports')),
        theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
        headers: headers === 'show' || headers === 'hide' ? headers : 'auto',
        interaction: interaction === 'none' ? 'none' : 'plot',
        controls: controlsAttribute === null ? ['reset', 'fullscreen'] : controls,
      }
    }

    _render(message, isError) {
      this._shadow.innerHTML = `
        <style>
          :host { position: relative; min-height: 240px; }
          iframe { width: 100%; height: 100%; border: 0; display: block; background: transparent; }
          .status { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px;
            box-sizing: border-box; background: #f5f6f8; color: ${isError ? '#9f2525' : '#4d5562'};
            font: 500 14px/1.4 system-ui, sans-serif; text-align: center; }
        </style>
        <div class="status" role="${isError ? 'alert' : 'status'}"></div>
      `
      this._shadow.querySelector('.status').textContent = message
    }

    async _start() {
      const runId = ++this._runId
      const src = this.getAttribute('src')
      if (!src) {
        this._render('Set the src attribute to a Fork system ZIP.', true)
        return
      }
      let sourceUrl
      try {
        sourceUrl = new URL(src, document.baseURI)
        if (sourceUrl.protocol !== 'http:' && sourceUrl.protocol !== 'https:') {
          throw new Error('Only HTTP(S) system archive URLs are supported.')
        }
      } catch (error) {
        this._render(error instanceof Error ? error.message : String(error), true)
        return
      }

      this._render('Loading Fork system…', false)
      const runNonce = nonce()
      const frame = document.createElement('iframe')
      const frameUrl = new URL(viewerUrl)
      frameUrl.hash = `nonce=${encodeURIComponent(runNonce)}`
      frame.src = frameUrl.href
      frame.title = this.getAttribute('title') || 'Fork Dynamics visualization'
      frame.sandbox = 'allow-scripts allow-same-origin'
      frame.allow = 'fullscreen'

      try {
        const archivePromise = fetch(sourceUrl.href, { credentials: 'same-origin' }).then(readBounded)
        const readyPromise = new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Fork embed viewer did not start.')), 15000)
          const onMessage = (event) => {
            const data = event.data
            if (event.origin !== viewerOrigin || event.source !== frame.contentWindow) return
            if (!data || data.type !== 'fork-embed:ready' || data.version !== VERSION || data.nonce !== runNonce) return
            window.clearTimeout(timeout)
            window.removeEventListener('message', onMessage)
            resolve()
          }
          window.addEventListener('message', onMessage)
        })
        this._shadow.innerHTML = '<style>:host{position:relative;min-height:240px}iframe{width:100%;height:100%;border:0;display:block}</style>'
        this._shadow.appendChild(frame)
        const [archive] = await Promise.all([archivePromise, readyPromise])
        if (runId !== this._runId) return
        const channel = new MessageChannel()
        channel.port1.onmessage = (event) => {
          if (runId !== this._runId) return
          if (event.data && event.data.type === 'fork-embed:error') {
            this._render(event.data.message || 'Unable to load Fork system.', true)
          }
          if (event.data && event.data.type === 'fork-embed:loaded') {
            this.dispatchEvent(new CustomEvent('fork-load', { detail: event.data }))
          }
        }
        frame.contentWindow.postMessage(
          {
            type: 'fork-embed:init',
            version: VERSION,
            nonce: runNonce,
            archive,
            spec: this._spec(),
          },
          viewerOrigin,
          [archive, channel.port2]
        )
      } catch (error) {
        if (runId !== this._runId) return
        this._render(error instanceof Error ? error.message : String(error), true)
        this.dispatchEvent(new CustomEvent('fork-error', { detail: { message: String(error) } }))
      }
    }
  }

  if (!customElements.get('fork-embed')) {
    customElements.define('fork-embed', ForkEmbedElement)
  }
})()
