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

/** Moves focus between the enabled buttons of a menu (arrow-key navigation). */
export function focusMenuItem(
  menu: HTMLElement | null,
  direction: 1 | -1 | 'first' | 'last'
) {
  if (!menu) return
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  let next: number
  if (direction === 'first') next = 0
  else if (direction === 'last') next = items.length - 1
  else if (current === -1) next = direction === 1 ? 0 : items.length - 1
  else next = (current + direction + items.length) % items.length
  items[next]?.focus()
}
