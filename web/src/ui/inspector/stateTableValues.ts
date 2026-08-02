export function adjustArray<T>(values: T[], targetLength: number, fill: () => T): T[] {
  if (values.length === targetLength) return values
  if (values.length > targetLength) return values.slice(0, targetLength)
  return [...values, ...Array.from({ length: targetLength - values.length }, fill)]
}

const POINT_NUMBER_REGEX = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

export function parsePointValues(text: string): number[] {
  const matches = text.match(POINT_NUMBER_REGEX)
  if (!matches) return []
  return matches
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
}

export function formatPointValues(
  values: Array<number | string | null | undefined>
): string {
  const formatted = values.map((value) => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value.toString() : 'NaN'
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : 'NaN'
    }
    return 'NaN'
  })
  return `[${formatted.join(', ')}]`
}

export async function writeClipboardText(value: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    return
  }
}

export async function readClipboardText(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return null
  try {
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}

export function applyPointValues(
  prev: string[],
  targetLength: number,
  values: number[]
): string[] {
  const next = [...adjustArray(prev, targetLength, () => '0')]
  if (values.length === 0) return next
  const trimmed =
    values.length >= targetLength ? values.slice(values.length - targetLength) : values
  trimmed.forEach((value, index) => {
    if (Number.isFinite(value)) {
      next[index] = value.toString()
    }
  })
  return next
}
