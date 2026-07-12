import { describe, expect, it } from 'vitest'
import type { StandaloneEmbed } from './types'
import {
  MATHJAX_CDN_URL,
  PLOTLY_CDN_URL,
  buildStandaloneHtml,
  standaloneEmbedFilename,
} from './standaloneHtml'

function fixture(overrides: Partial<StandaloneEmbed> = {}): StandaloneEmbed {
  return {
    title: 'Shared plot',
    theme: 'dark',
    headers: 'auto',
    interaction: 'plot',
    viewports: [
      {
        id: 'scene-secret-id',
        name: 'Scene </script><script>alert(1)</script>',
        type: 'State Space',
        height: 420,
        figure: {
          data: [{ type: 'scatter', x: [1, 2], y: [3, 4] }],
          layout: { title: { text: 'Safe < title' } },
        },
      },
    ],
    ...overrides,
  }
}

describe('standalone Plotly HTML', () => {
  it('contains pinned CDN dependencies and only declarative plot payloads', () => {
    const html = buildStandaloneHtml(fixture())

    expect(html).toContain(PLOTLY_CDN_URL)
    expect(html).toContain(MATHJAX_CDN_URL)
    expect(html).toContain('window.Plotly.newPlot')
    expect(html).toContain('"x":[1,2]')
    expect(html).not.toContain('fork-embed')
    expect(html).not.toContain('forkdynamics.com')
    expect(html).not.toContain('scene-secret-id')
    expect(html).not.toContain('</script><script>alert(1)</script>')
    expect(html).toContain('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>')
  })

  it('freezes theme, interaction, header visibility, and viewport heights', () => {
    const html = buildStandaloneHtml(
      fixture({ theme: 'light', headers: 'show', interaction: 'none' })
    )

    expect(html).toContain('color-scheme: light')
    expect(html).toContain("display: flex")
    expect(html).toContain("staticPlot: payload.interaction === 'none'")
    expect(html).toContain('"interaction":"none"')
    expect(html).toContain('"height":420')
  })

  it('uses a stable HTML filename', () => {
    expect(standaloneEmbedFilename('Lorenz System')).toBe('Lorenz_System_embed.html')
    expect(standaloneEmbedFilename('')).toBe('fork_plot_embed.html')
  })
})
