import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { StandaloneEmbed } from './types'
import {
  MATHJAX_CDN_URL,
  PLOTLY_CDN_URL,
  buildBundledStandaloneHtml,
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

function gzipBase64(value: unknown): string {
  return Buffer.from(gzipSync(strToU8(JSON.stringify(value)), { level: 9 })).toString('base64')
}

function decodeGzipJson(value: string): unknown {
  return JSON.parse(strFromU8(gunzipSync(new Uint8Array(Buffer.from(value, 'base64')))))
}

function scriptData(html: string, id: string): string {
  const match = html.match(new RegExp(`<script id="${id}"[^>]*>([^<]+)</script>`))
  if (!match?.[1]) throw new Error(`Missing ${id}`)
  return match[1]
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

  it('compresses dependencies and figure data without CDN or injectable markup', () => {
    const dependencyPackage = {
      plotlySource: 'window.Plotly={newPlot(){}};// </script><script>alert(1)</script>',
      mathJaxSource: 'window.MathJax={startup:{promise:Promise.resolve()}};',
    }
    const html = buildBundledStandaloneHtml(fixture(), {
      dependenciesGzipBase64: gzipBase64(dependencyPackage),
    })

    expect(html).not.toContain(PLOTLY_CDN_URL)
    expect(html).not.toContain(MATHJAX_CDN_URL)
    expect(html).not.toContain('"x":[1,2]')
    expect(html).not.toContain('</script><script>alert(1)</script>')
    expect(html).toContain("new DecompressionStream('gzip')")
    expect(html).toContain('license texts are preserved')
    expect(html).toContain('installScript(dependencies.plotlySource')
    expect(html).toContain("staticPlot: payload.interaction === 'none'")
    expect(html).not.toContain('scene-secret-id')
    expect(html).not.toContain('fork_wasm')

    expect(decodeGzipJson(scriptData(html, 'bundled-dependencies'))).toEqual(
      dependencyPackage
    )
    expect(decodeGzipJson(scriptData(html, 'plot-data'))).toMatchObject({
      interaction: 'plot',
      viewports: [
        {
          name: 'Scene </script><script>alert(1)</script>',
          height: 420,
          figure: { data: [{ x: [1, 2], y: [3, 4] }] },
        },
      ],
    })
  })

  it('makes bundled 2D GPU traces SVG-compatible and preserves 3D image fallbacks', () => {
    const dependencyPackage = {
      plotlySource: 'window.Plotly={newPlot(){}};',
      mathJaxSource: 'window.MathJax={startup:{promise:Promise.resolve()}};',
    }
    const embed = fixture({
      viewports: [
        {
          id: 'event-map',
          name: 'Event map',
          type: 'Event Map',
          height: 300,
          figure: {
            data: [{ type: 'scattergl', mode: 'markers', x: [1], y: [2] }],
            layout: {},
          },
        },
        {
          id: 'state-space',
          name: '3D state space',
          type: 'State Space',
          height: 420,
          figure: {
            data: [{ type: 'scatter3d', x: [1], y: [2], z: [3] }],
            layout: { scene: { camera: { eye: { x: 1, y: 2, z: 3 } } } },
          },
          fallbackImage: 'data:image/png;base64,captured-camera',
        },
      ],
    })

    const bundled = buildBundledStandaloneHtml(embed, {
      dependenciesGzipBase64: gzipBase64(dependencyPackage),
    })
    const payload = decodeGzipJson(scriptData(bundled, 'plot-data')) as {
      viewports: Array<{
        figure: { data: Array<{ type?: string }> }
        fallbackImage?: string
      }>
    }

    expect(payload.viewports[0]?.figure.data[0]?.type).toBe('scatter')
    expect(payload.viewports[1]?.figure.data[0]?.type).toBe('scatter3d')
    expect(payload.viewports[1]?.fallbackImage).toBe(
      'data:image/png;base64,captured-camera'
    )
    expect(bundled).toContain("canvas.getContext('webgl')")
    expect(bundled).toContain('renderStaticFallback')

    const cdn = buildStandaloneHtml(embed)
    expect(cdn).toContain('"type":"scattergl"')
    expect(cdn).not.toContain('data:image/png;base64,captured-camera')
  })

  it('uses a stable HTML filename', () => {
    expect(standaloneEmbedFilename('Lorenz System')).toBe('Lorenz_System_embed.html')
    expect(standaloneEmbedFilename('')).toBe('fork_plot_embed.html')
  })
})
