import { useRef } from 'react'
import type { SystemSummary } from '../system/types'
import { Icon } from './Icon'
import { SystemLibrary, type SystemLibraryActions } from './SystemLibrary'
import { useModalDialog } from './useModalDialog'
import './dialogs.css'

type SystemDialogProps = SystemLibraryActions & {
  open: boolean
  systems: SystemSummary[]
  activeSystemId?: string | null
  onClose: () => void
}

export function SystemDialog({ open, onClose, ...library }: SystemDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  // The library focuses its first row itself; the hook adds Esc, backdrop and focus restore.
  const backdropProps = useModalDialog(open, dialogRef, onClose)

  if (!open) return null

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="systems-title"
      {...backdropProps}
    >
      <div className="dialog dialog--workspace sys-dialog" ref={dialogRef}>
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
