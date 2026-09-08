const MENU_EDGE_PADDING = 8

export function clampMenuX(x: number, menuWidth: number) {
  if (typeof window === 'undefined') return x
  const maxX = window.innerWidth - menuWidth - MENU_EDGE_PADDING
  return Math.max(MENU_EDGE_PADDING, Math.min(x, Math.max(MENU_EDGE_PADDING, maxX)))
}

export function clampMenuY(y: number, menuHeight: number) {
  if (typeof window === 'undefined') return y
  const maxY = window.innerHeight - menuHeight - MENU_EDGE_PADDING
  return Math.max(MENU_EDGE_PADDING, Math.min(y, Math.max(MENU_EDGE_PADDING, maxY)))
}
