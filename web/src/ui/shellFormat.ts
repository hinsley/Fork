export type ToolbarSystem = {
  name: string
  type: 'flow' | 'map'
  dimension: number
  solver: string
}

/** `Flow · 3D · rk4` (maps omit the solver). */
export function formatSystemChip(system: ToolbarSystem): string {
  const parts = [system.type === 'map' ? 'Map' : 'Flow', `${system.dimension}D`]
  if (system.type === 'flow' && system.solver) parts.push(system.solver)
  return parts.join(' · ')
}

/**
 * Subsequence fuzzy score (higher is better, -1 = no match). Rewards consecutive
 * characters and matches at word starts so "lc" ranks "Limit Cycle" above "Local".
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const t = text.toLowerCase()
  const direct = t.indexOf(q)
  if (direct >= 0) return 1000 - direct - t.length * 0.01 + (direct === 0 ? 500 : 0)
  let score = 0
  let ti = 0
  let previous = -2
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    const atWordStart = found === 0 || /[\s_\-·./]/.test(t[found - 1] ?? '')
    const upperStart = found > 0 && text[found] !== t[found] && text[found - 1] === t[found - 1]
    score += found === previous + 1 ? 8 : 1
    if (atWordStart || upperStart) score += 6
    previous = found
    ti = found + 1
  }
  return score - t.length * 0.01
}
