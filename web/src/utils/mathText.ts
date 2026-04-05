const MATHJAX_WRAPPERS = [
  { open: '$$', close: '$$' },
  { open: '\\[', close: '\\]' },
  { open: '\\(', close: '\\)' },
  { open: '$', close: '$' },
] as const

const MATH_SAFE_TEXT_PATTERN = /^[\s0-9+\-*/=<>()[\],.:;|]+$/

type MathSegment = {
  kind: 'math'
  raw: string
  content: string
  open: (typeof MATHJAX_WRAPPERS)[number]['open']
  close: (typeof MATHJAX_WRAPPERS)[number]['close']
  start: number
  end: number
}

type TextSegment = {
  kind: 'text'
  raw: string
}

type MathTextSegment = MathSegment | TextSegment

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

function tryMatchMathSegment(
  text: string,
  start: number,
  wrapper: (typeof MATHJAX_WRAPPERS)[number]
): MathSegment | null {
  if (!text.startsWith(wrapper.open, start)) return null
  if (wrapper.open.startsWith('$') && isEscaped(text, start)) return null
  if (wrapper.open === '$' && (text[start - 1] === '$' || text[start + 1] === '$')) {
    return null
  }

  let endSearch = start + wrapper.open.length
  while (endSearch < text.length) {
    const endStart = findDelimiter(text, wrapper.close, endSearch)
    if (endStart < 0) return null
    if (wrapper.close === '$' && (text[endStart - 1] === '$' || text[endStart + 1] === '$')) {
      endSearch = endStart + wrapper.close.length
      continue
    }
    if (endStart === start + wrapper.open.length) {
      endSearch = endStart + wrapper.close.length
      continue
    }
    return {
      kind: 'math',
      raw: text.slice(start, endStart + wrapper.close.length),
      content: text.slice(start + wrapper.open.length, endStart),
      open: wrapper.open,
      close: wrapper.close,
      start,
      end: endStart + wrapper.close.length,
    }
  }
  return null
}

function findNextMathSegment(text: string, fromIndex = 0): MathSegment | null {
  for (let start = fromIndex; start < text.length; start += 1) {
    for (const wrapper of MATHJAX_WRAPPERS) {
      const segment = tryMatchMathSegment(text, start, wrapper)
      if (segment) return segment
    }
  }
  return null
}

function tokenizeMathText(text: string): MathTextSegment[] {
  const segments: MathTextSegment[] = []
  let cursor = 0
  while (cursor < text.length) {
    const segment = findNextMathSegment(text, cursor)
    if (!segment) {
      segments.push({ kind: 'text', raw: text.slice(cursor) })
      break
    }
    if (segment.start > cursor) {
      segments.push({ kind: 'text', raw: text.slice(cursor, segment.start) })
    }
    segments.push(segment)
    cursor = segment.end
  }
  return segments
}

function escapeTextForMathJax(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}#$%&_])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
}

function normalizePlainTextSegmentForMath(text: string): string {
  if (text.length === 0) return ''
  if (MATH_SAFE_TEXT_PATTERN.test(text)) {
    return text
  }
  return `\\text{${escapeTextForMathJax(text)}}`
}

export function containsMathJaxMarkup(text: string): boolean {
  return tokenizeMathText(text).some((segment) => segment.kind === 'math')
}

export function appendMathJaxWrappedSuffix(label: string, suffix: string): string {
  const trimmed = label.trim()
  const start = label.indexOf(trimmed)
  const leading = start >= 0 ? label.slice(0, start) : ''
  const trailing = start >= 0 ? label.slice(start + trimmed.length) : ''
  const segments = tokenizeMathText(trimmed)
  if (segments.length === 1 && segments[0]?.kind === 'math' && segments[0].raw === trimmed) {
    return `${leading}${segments[0].open}${segments[0].content}${suffix}${segments[0].close}${trailing}`
  }
  return `${label}${suffix}`
}

export function normalizeMathJaxForPlotly(text: string): string {
  const segments = tokenizeMathText(text)
  const mathSegments = segments.filter((segment) => segment.kind === 'math')
  if (mathSegments.length === 0) return text

  const trimmed = text.trim()
  const trimmedSegments = tokenizeMathText(trimmed)
  if (
    trimmedSegments.length === 1 &&
    trimmedSegments[0]?.kind === 'math' &&
    trimmedSegments[0].raw === trimmed
  ) {
    return text
  }

  const body = segments
    .map((segment) =>
      segment.kind === 'math'
        ? segment.content
        : normalizePlainTextSegmentForMath(segment.raw)
    )
    .join('')
  return `${'$'}${body}${'$'}`
}
