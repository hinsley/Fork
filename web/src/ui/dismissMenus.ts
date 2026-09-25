/** Window event that asks every open popup menu (viewport create/context menus, axis picker) to close. */
export const DISMISS_MENUS_EVENT = 'fork:dismiss-menus'

export function dismissOpenMenus() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(DISMISS_MENUS_EVENT))
}
