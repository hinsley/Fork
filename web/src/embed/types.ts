export const EMBED_PROTOCOL_VERSION = 1 as const

export type EmbedTheme = 'auto' | 'light' | 'dark'
export type EmbedHeaders = 'auto' | 'show' | 'hide'
export type EmbedInteraction = 'plot' | 'none'
export type EmbedControl = 'reset' | 'fullscreen'

export type EmbedSpecV1 = {
  version: typeof EMBED_PROTOCOL_VERSION
  viewportIds: string[]
  theme: EmbedTheme
  headers: EmbedHeaders
  interaction: EmbedInteraction
  controls: EmbedControl[]
}

export const DEFAULT_EMBED_SPEC: EmbedSpecV1 = {
  version: EMBED_PROTOCOL_VERSION,
  viewportIds: [],
  theme: 'auto',
  headers: 'auto',
  interaction: 'plot',
  controls: ['reset', 'fullscreen'],
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))]
}

export function normalizeEmbedSpec(value: unknown): EmbedSpecV1 {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const theme: EmbedTheme =
    record.theme === 'light' || record.theme === 'dark' ? record.theme : 'auto'
  const headers: EmbedHeaders =
    record.headers === 'show' || record.headers === 'hide' ? record.headers : 'auto'
  const interaction: EmbedInteraction = record.interaction === 'none' ? 'none' : 'plot'
  const controls = stringArray(record.controls).filter(
    (control): control is EmbedControl => control === 'reset' || control === 'fullscreen'
  )

  return {
    version: EMBED_PROTOCOL_VERSION,
    viewportIds: stringArray(record.viewportIds),
    theme,
    headers,
    interaction,
    controls: 'controls' in record ? controls : [...DEFAULT_EMBED_SPEC.controls],
  }
}

export type EmbedReadyMessage = {
  type: 'fork-embed:ready'
  version: typeof EMBED_PROTOCOL_VERSION
  nonce: string
}

export type EmbedInitMessage = {
  type: 'fork-embed:init'
  version: typeof EMBED_PROTOCOL_VERSION
  nonce: string
  archive: ArrayBuffer
  spec: EmbedSpecV1
}

export type EmbedPortMessage =
  | { type: 'fork-embed:loaded'; systemName: string }
  | { type: 'fork-embed:error'; message: string }
