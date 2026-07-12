import { gzipSync, strToU8 } from 'fflate'
import type { BundledDependencyPayload } from './standaloneDependencies'
import type { StandaloneEmbed } from './types'

export const PLOTLY_CDN_URL = 'https://cdn.plot.ly/plotly-2.32.0.min.js'
export const MATHJAX_CDN_URL =
  'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js'

const MIN_VIEWPORT_HEIGHT = 220

const THEMES = {
  light: {
    background: '#eef2f5',
    panel: '#ffffff',
    border: '#d9e1e7',
    header: '#f7f9fa',
    text: '#17202b',
    muted: '#687687',
    errorBackground: '#fff0f0',
    errorText: '#9f2525',
  },
  dark: {
    background: '#0b1017',
    panel: '#111923',
    border: '#263344',
    header: '#131d28',
    text: '#e8edf5',
    muted: '#8f9caf',
    errorBackground: '#351b20',
    errorText: '#ff9aa5',
  },
} as const

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function standaloneEmbedFilename(systemName: string): string {
  const base = systemName.replace(/\s+/g, '_') || 'fork_plot'
  return `${base}_embed.html`
}

function buildPlotPayload(embed: StandaloneEmbed) {
  return {
    interaction: embed.interaction,
    viewports: embed.viewports.map((viewport) => ({
      name: viewport.name,
      type: viewport.type,
      height: Math.max(MIN_VIEWPORT_HEIGHT, Math.round(viewport.height)),
      figure: viewport.figure,
    })),
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function gzipJsonToBase64(value: unknown): string {
  return bytesToBase64(gzipSync(strToU8(JSON.stringify(value)), { level: 9 }))
}

const RENDER_PAYLOAD_SOURCE = `
    async function renderPayload(payload) {
      const root = document.getElementById('plots');
      for (let index = 0; index < payload.viewports.length; index += 1) {
        const viewport = payload.viewports[index];
        const card = document.createElement('section');
        card.className = 'plot-card';
        card.style.height = viewport.height + 'px';
        const header = document.createElement('header');
        header.className = 'plot-header';
        const name = document.createElement('span');
        name.className = 'plot-title';
        name.textContent = viewport.name;
        const type = document.createElement('span');
        type.className = 'plot-type';
        type.textContent = viewport.type;
        header.append(name, type);
        const plot = document.createElement('div');
        plot.className = 'plot';
        plot.id = 'plot-' + index;
        card.append(header, plot);
        root.append(card);
        const config = {
          displaylogo: false,
          displayModeBar: payload.interaction === 'plot',
          responsive: true,
          scrollZoom: payload.interaction === 'plot',
          doubleClick: false,
          staticPlot: payload.interaction === 'none',
          typesetMath: true
        };
        await window.Plotly.newPlot(plot, viewport.figure.data, viewport.figure.layout, config);
      }
    }
`

function buildHtmlDocument({
  embed,
  headScripts,
  dataScripts,
  runtime,
}: {
  embed: StandaloneEmbed
  headScripts: string
  dataScripts: string
  runtime: string
}): string {
  const theme = THEMES[embed.theme]
  const showHeaders =
    embed.headers === 'show' ||
    (embed.headers === 'auto' && embed.viewports.length > 1)
  const title = escapeHtml(embed.title)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: ${embed.theme}; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: ${theme.background}; color: ${theme.text}; }
    #plots { display: flex; flex-direction: column; width: 100%; }
    .plot-card { display: flex; flex-direction: column; min-height: ${MIN_VIEWPORT_HEIGHT}px; background: ${theme.panel}; border-bottom: 1px solid ${theme.border}; }
    .plot-header { display: ${showHeaders ? 'flex' : 'none'}; align-items: center; justify-content: space-between; gap: 12px; min-height: 42px; padding: 7px 10px; background: ${theme.header}; border-bottom: 1px solid ${theme.border}; }
    .plot-title { font-size: 13px; font-weight: 650; }
    .plot-type { color: ${theme.muted}; font-size: 10px; letter-spacing: .05em; text-transform: uppercase; }
    .plot { flex: 1 1 auto; min-height: 0; width: 100%; }
    #error { display: none; margin: 16px; padding: 12px; border-radius: 6px; color: ${theme.errorText}; background: ${theme.errorBackground}; white-space: pre-wrap; }
  </style>
${headScripts}
</head>
<body>
  <main id="plots" aria-label="${title}"></main>
  <div id="error" role="alert"></div>
${dataScripts}
  <script>
${runtime}
  </script>
</body>
</html>`
}

export function buildStandaloneHtml(embed: StandaloneEmbed): string {
  const payload = buildPlotPayload(embed)
  const headScripts = `  <script>
    window.MathJax = {
      tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']] },
      svg: { fontCache: 'local' },
      startup: { typeset: false }
    };
  </script>
  <script src="${MATHJAX_CDN_URL}" onerror="window.__plotExportDependencyError='MathJax failed to load.'"></script>
  <script src="${PLOTLY_CDN_URL}" onerror="window.__plotExportDependencyError='Plotly.js failed to load.'"></script>`
  const dataScripts = `  <script id="plot-data" type="application/json">${safeJson(payload)}</script>`
  const runtime = `
    (async function () {
      const errorNode = document.getElementById('error');
      function fail(message) {
        errorNode.textContent = message;
        errorNode.style.display = 'block';
      }
      if (window.__plotExportDependencyError) {
        fail(window.__plotExportDependencyError);
        return;
      }
      if (!window.Plotly) {
        fail('Plotly.js failed to load. Check your connection and Content Security Policy.');
        return;
      }
      try {
        if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
          await window.MathJax.startup.promise;
        }
        const payload = JSON.parse(document.getElementById('plot-data').textContent);
        await renderPayload(payload);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    })();
${RENDER_PAYLOAD_SOURCE}`

  return buildHtmlDocument({ embed, headScripts, dataScripts, runtime })
}

export function buildBundledStandaloneHtml(
  embed: StandaloneEmbed,
  dependencies: BundledDependencyPayload
): string {
  const payloadGzipBase64 = gzipJsonToBase64(buildPlotPayload(embed))
  const dataScripts = `  <!-- Bundled Plotly.js and MathJax license texts are preserved in the dependency payload. -->
  <script id="bundled-dependencies" type="application/octet-stream">${dependencies.dependenciesGzipBase64}</script>
  <script id="plot-data" type="application/octet-stream">${payloadGzipBase64}</script>`
  const runtime = `
    const errorNode = document.getElementById('error');
    function fail(message) {
      errorNode.textContent = message;
      errorNode.style.display = 'block';
    }

    function decodeBase64(value) {
      const binary = atob(value.trim());
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }

    async function decompressJson(elementId) {
      if (typeof DecompressionStream !== 'function') {
        throw new Error('This bundled embed requires a browser with gzip decompression support.');
      }
      const source = document.getElementById(elementId);
      if (!source) throw new Error('Bundled embed data is missing.');
      const compressed = decodeBase64(source.textContent || '');
      const stream = new Blob([compressed])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(await new Response(stream).text());
    }

    function installScript(source, label) {
      const script = document.createElement('script');
      script.textContent = source + '\\n//# sourceURL=fork-embed-' + label + '.js';
      document.head.appendChild(script);
      script.remove();
    }

    (async function () {
      try {
        const [dependencies, payload] = await Promise.all([
          decompressJson('bundled-dependencies'),
          decompressJson('plot-data')
        ]);
        window.MathJax = {
          tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']] },
          svg: { fontCache: 'local' },
          startup: { typeset: false }
        };
        installScript(dependencies.mathJaxSource, 'mathjax');
        installScript(dependencies.plotlySource, 'plotly');
        if (!window.Plotly) {
          throw new Error('Bundled Plotly.js failed to initialize. The host may block inline scripts.');
        }
        if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
          await window.MathJax.startup.promise;
        }
        await renderPayload(payload);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    })();
${RENDER_PAYLOAD_SOURCE}`

  return buildHtmlDocument({ embed, headScripts: '', dataScripts, runtime })
}

export function downloadStandaloneHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
