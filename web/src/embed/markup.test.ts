import { describe, expect, it } from 'vitest'
import { buildEmbedMarkup } from './markup'

describe('embed markup', () => {
  it('generates a versioned custom element snippet and escapes author input', () => {
    const markup = buildEmbedMarkup({
      source: './A&B".zip',
      spec: {
        version: 1,
        viewportIds: ['scene-a', 'diagram-b'],
        theme: 'dark',
        headers: 'show',
        interaction: 'plot',
      },
      width: '100%',
      height: 640,
    })

    expect(markup).toContain('https://www.forkdynamics.com/embed/v1.js')
    expect(markup).toContain('src="./A&amp;B&quot;.zip"')
    expect(markup).toContain('viewports="scene-a,diagram-b"')
    expect(markup).not.toContain('controls=')
    expect(markup).toContain('height:640px')
  })
})
