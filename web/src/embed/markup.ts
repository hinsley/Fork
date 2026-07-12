import type { EmbedSpecV1 } from './types'

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
export function buildEmbedMarkup(options: {
  source: string
  spec: EmbedSpecV1
  width: string
  height: number
}): string {
  const viewports = options.spec.viewportIds.join(',')
  return [
    '<script defer src="https://www.forkdynamics.com/embed/v1.js"></script>',
    '',
    '<fork-embed',
    `  src="${escapeAttribute(options.source)}"`,
    `  viewports="${escapeAttribute(viewports)}"`,
    `  theme="${options.spec.theme}"`,
    `  headers="${options.spec.headers}"`,
    `  interaction="${options.spec.interaction}"`,
    `  style="display:block;width:${escapeAttribute(options.width)};height:${options.height}px"`,
    '></fork-embed>',
  ].join('\n')
}
