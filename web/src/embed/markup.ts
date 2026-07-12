function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function buildIframeMarkup(options: {
  source: string
  title: string
  width: string
  height: number
}): string {
  return [
    '<iframe',
    `  src="${escapeAttribute(options.source)}"`,
    `  title="${escapeAttribute(options.title)}"`,
    `  style="display:block;width:${escapeAttribute(options.width)};height:${options.height}px;border:0"`,
    '  loading="lazy"',
    '></iframe>',
  ].join('\n')
}
