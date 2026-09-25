import { useCallback, useRef, useState } from 'react'
import { SystemEditorPanel } from './inspector/SystemEditorPanel'
import type { System } from '../system/types'
import type { SystemEditorActions } from './inspector/types'
import { Icon } from './Icon'
import { useModalDialog } from './useModalDialog'
import './dialogs.css'

export const DISCARD_SYSTEM_CHANGES_MESSAGE = 'Discard unsaved changes?'

type SystemSettingsDialogProps = {
  open: boolean
  system: System | null
  onClose: () => void
  actions: SystemEditorActions
}

export function SystemSettingsDialog({
  open,
  system,
  onClose,
  actions,
}: SystemSettingsDialogProps) {
  const [toolsSlot, setToolsSlot] = useState<HTMLSpanElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const dirtyRef = useRef(false)
  const isOpen = open && Boolean(system)
  const requestClose = useCallback(() => {
    if (dirtyRef.current && !window.confirm(DISCARD_SYSTEM_CHANGES_MESSAGE)) return
    dirtyRef.current = false
    onClose()
  }, [onClose])
  const backdropProps = useModalDialog(isOpen, dialogRef, requestClose, {
    initialFocus: 'container',
  })
  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
  }, [])
  if (!isOpen || !system) return null

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-settings-title"
      data-testid="system-settings-dialog"
      {...backdropProps}
    >
      <div className="dialog dialog--workspace dialog--system-settings" ref={dialogRef}>
        <header className="dialog__header system-settings-dialog__header">
          <h2 id="system-settings-title">System settings</h2>
          <span className="system-settings-dialog__tools" ref={setToolsSlot} />
          <button
            className="icon-btn dialog__close"
            onClick={requestClose}
            aria-label="Close system settings"
            title="Close"
            data-testid="close-system-settings"
          >
            <Icon name="close" />
          </button>
        </header>
        <SystemEditorPanel
          systemId={system.id}
          config={system.config}
          actions={actions}
          toolsContainer={toolsSlot}
          onDirtyChange={onDirtyChange}
        />
      </div>
    </div>
  )
}
