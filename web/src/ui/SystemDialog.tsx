import { useEffect } from 'react'
import type { SystemSummary } from '../system/types'
import { Icon } from './Icon'
import { SystemLibrary, type SystemLibraryActions } from './SystemLibrary'
import './dialogs.css'

type SystemDialogProps = SystemLibraryActions & {
  open: boolean
  systems: SystemSummary[]
  activeSystemId?: string | null
  onClose: () => void
}

export function SystemDialog({ open, onClose, ...library }: SystemDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="systems-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog dialog--workspace sys-dialog">
        <header className="dialog__header sys-dialog__header">
          <h2 id="systems-title">Systems</h2>
          <button className="dialog__close" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" size={15} />
          </button>
        </header>
        <SystemLibrary {...library} autoFocusFirst />
      </div>
    </div>
  )
}
