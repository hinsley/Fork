import { describe, expect, it } from 'vitest'
import { buildIframeMarkup } from './markup'

describe('embed iframe markup', () => {
  it('generates a plain iframe and escapes author input', () => {
    const markup = buildIframeMarkup({
      source: './A&B"_embed.html',
      title: 'A <plot>',
      width: '100%',
      height: 640,
    })

    expect(markup).toContain('<iframe')
    expect(markup).toContain('src="./A&amp;B&quot;_embed.html"')
    expect(markup).toContain('title="A &lt;plot&gt;"')
    expect(markup).toContain('height:640px')
    expect(markup).not.toContain('fork-embed')
    expect(markup).not.toContain('forkdynamics.com')
  })
})
