const MATHJAX_WRAPPERS = [
  { open: '$$', close: '$$' },
  { open: '\\[', close: '\\]' },
  { open: '\\(', close: '\\)' },
  { open: '$', close: '$' },
] as const

function isEscaped(text: string, index: number): boolean {
  let backslashCount = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1
  }
  return backslashCount % 2 === 1
}

function findDelimiter(text: string, delimiter: string, fromIndex = 0): number {
  let index = fromIndex
  while (index < text.length) {
    const next = text.indexOf(delimiter, index)
    if (next < 0) return -1
    if (delimiter.startsWith('$') && isEscaped(text, next)) {
      index = next + delimiter.length
      continue
    }
    return next
  }
  return -1
}

function findPairedDelimiterSegment(
  text: string,
  open: string,
  close: string
): { start: number; end: number } | null {
  let searchStart = 0
  while (searchStart < text.length) {
    const start = findDelimiter(text, open, searchStart)
    if (start < 0) return null
    let endSearch = start + open.length
    while (endSearch < text.length) {
      const endStart = findDelimiter(text, close, endSearch)
      if (endStart < 0) return null
      if (endStart > start + open.length) {
        return { start, end: endStart + close.length }
      }
      endSearch = endStart + close.length
    }
    searchStart = start + open.length
  }
  return null
}

function findSingleDollarSegment(text: string): { start: number; end: number } | null {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '$' || isEscaped(text, start)) continue
    if (text[start - 1] === '$' || text[start + 1] === '$') continue
    for (let end = start + 1; end < text.length; end += 1) {
      if (text[end] !== '$' || isEscaped(text, end)) continue
      if (text[end - 1] === '$' || text[end + 1] === '$') continue
      if (end > start + 1) {
        return { start, end: end + 1 }
      }
      break
    }
  }
  return null
}

function findMathJaxSegment(text: string): { start: number; end: number } | null {
  for (const wrapper of MATHJAX_WRAPPERS) {
    if (wrapper.open === '$') {
      const segment = findSingleDollarSegment(text)
      if (segment) return segment
      continue
    }
    const segment = findPairedDelimiterSegment(text, wrapper.open, wrapper.close)
    if (segment) return segment
  }
  return null
}

export function containsMathJaxMarkup(text: string): boolean {
  return findMathJaxSegment(text) !== null
}

export function appendMathJaxWrappedSuffix(label: string, suffix: string): string {
  const trimmed = label.trim()
  const start = label.indexOf(trimmed)
  const leading = start >= 0 ? label.slice(0, start) : ''
  const trailing = start >= 0 ? label.slice(start + trimmed.length) : ''
  for (const wrapper of MATHJAX_WRAPPERS) {
    if (!trimmed.startsWith(wrapper.open) || !trimmed.endsWith(wrapper.close)) continue
    const segment = findMathJaxSegment(trimmed)
    if (!segment || segment.start !== 0 || segment.end !== trimmed.length) continue
    const content = trimmed.slice(wrapper.open.length, trimmed.length - wrapper.close.length)
    if (content.length === 0) continue
    return `${leading}${wrapper.open}${content}${suffix}${wrapper.close}${trailing}`
  }
  return `${label}${suffix}`
}
