/**
 * Viewport stack sizing.
 *
 * `system.ui.viewportHeights` stores one number per viewport. The workspace
 * treats those numbers as relative flex weights so expanded viewports always
 * share the full column height. Older systems stored pixel heights (roughly
 * 200–900); those values remain valid weights, so no data migration is needed.
 * The default weight matches the previous default pixel height, which keeps the
 * standalone embed export (which reads the same numbers as pixel heights)
 * unchanged for viewports that were never resized.
 */

export const DEFAULT_VIEWPORT_WEIGHT = 360
/** Smallest pane height (px) a drag may leave for either neighbour (matches `.viewport-item` min-height). */
export const MIN_VIEWPORT_PANE_HEIGHT = 160

const MIN_WEIGHT = 1e-3

export function resolveViewportWeight(
  heights: Record<string, number> | null | undefined,
  id: string
): number {
  const value = heights?.[id]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_VIEWPORT_WEIGHT
  }
  return value
}

/**
 * Redistributes the combined weight of two adjacent viewports after dragging
 * the border between them by `delta` pixels. The pair's total weight is kept,
 * so every other viewport keeps its size.
 */
export function splitViewportPair(input: {
  heightA: number
  heightB: number
  weightA: number
  weightB: number
  delta: number
  minHeight?: number
}): { weightA: number; weightB: number } {
  const { heightA, heightB, weightA, weightB, delta } = input
  const totalHeight = heightA + heightB
  const totalWeight = weightA + weightB
  if (!(totalHeight > 0) || !(totalWeight > 0)) return { weightA, weightB }
  const minHeight = Math.min(input.minHeight ?? MIN_VIEWPORT_PANE_HEIGHT, totalHeight / 2)
  const nextHeightA = Math.min(
    totalHeight - minHeight,
    Math.max(minHeight, heightA + (Number.isFinite(delta) ? delta : 0))
  )
  const nextWeightA = Math.max(MIN_WEIGHT, (totalWeight * nextHeightA) / totalHeight)
  const nextWeightB = Math.max(MIN_WEIGHT, totalWeight - nextWeightA)
  return {
    weightA: Math.round(nextWeightA * 100) / 100,
    weightB: Math.round(nextWeightB * 100) / 100,
  }
}
