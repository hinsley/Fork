export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}

/** Human-readable shortcut, e.g. `⌘K` on macOS and `Ctrl+K` elsewhere. */
export function shortcutLabel(key: string, options: { mod?: boolean } = {}): string {
  if (!options.mod) return key
  return isMacPlatform() ? `⌘${key}` : `Ctrl+${key}`
}

/** True when a key event originates in a text field, where bare-key shortcuts must not fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type)
}
