import {
  useEffect,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react'

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * Shared modal behaviour: Esc requests close (unless a nested control already
 * consumed the key via `preventDefault`), focus moves into the dialog on open
 * and returns to the previously focused element on close.
 *
 * Returns props for the backdrop: a click closes only when the press started and
 * ended on the backdrop itself (a text selection dragged out of the dialog does not).
 */
export function useModalDialog(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onRequestClose: () => void,
  options: { initialFocus?: 'first' | 'container' } = {}
) {
  const requestCloseRef = useRef(onRequestClose)
  useEffect(() => {
    requestCloseRef.current = onRequestClose
  }, [onRequestClose])
  const initialFocus = options.initialFocus ?? 'first'

  // Capture the opener before children's effects (e.g. a list autofocusing its
  // first row) move focus, and hand focus back to it on close.
  useLayoutEffect(() => {
    if (!open) return
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (previous && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (container && !container.contains(document.activeElement)) {
      const target =
        initialFocus === 'first'
          ? container.querySelector<HTMLElement>(FOCUSABLE)
          : null
      if (target) {
        target.focus({ preventScroll: true })
      } else {
        if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1')
        container.focus({ preventScroll: true })
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // A modal stacked above this one (e.g. the command palette) owns Esc.
      const topmost = Array.from(document.querySelectorAll('[aria-modal="true"]')).at(-1)
      if (topmost && container && !topmost.contains(container) && !container.contains(topmost)) {
        return
      }
      event.preventDefault()
      requestCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [containerRef, initialFocus, open])

  const pressStartedOnBackdrop = useRef(false)
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      pressStartedOnBackdrop.current = event.target === event.currentTarget
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      const startedOnBackdrop = pressStartedOnBackdrop.current
      pressStartedOnBackdrop.current = false
      if (event.target === event.currentTarget && startedOnBackdrop) requestCloseRef.current()
    },
  }
}
