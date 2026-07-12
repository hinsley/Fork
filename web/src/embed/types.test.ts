import { describe, expect, it } from 'vitest'
import { DEFAULT_EMBED_SPEC, normalizeEmbedSpec } from './types'

describe('embed specification', () => {
  it('normalizes defaults and deduplicates viewport IDs', () => {
    expect(normalizeEmbedSpec({ viewportIds: ['scene-a', 'scene-a', 'scene-b'] })).toEqual({
      ...DEFAULT_EMBED_SPEC,
      viewportIds: ['scene-a', 'scene-b'],
    })
  })

  it('drops unsupported public options', () => {
    expect(
      normalizeEmbedSpec({
        theme: 'neon',
        headers: 'sometimes',
        interaction: 'edit',
        controls: ['reset', 'delete', 'fullscreen'],
      })
    ).toMatchObject({
      theme: 'auto',
      headers: 'auto',
      interaction: 'plot',
    })
    expect(normalizeEmbedSpec({ controls: ['reset', 'fullscreen'] })).not.toHaveProperty('controls')
  })
})
