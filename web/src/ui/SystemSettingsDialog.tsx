import { useState } from 'react'
import { SystemEditorPanel } from './inspector/SystemEditorPanel'
import type { System } from '../system/types'
import type { SystemEditorActions } from './inspector/types'
import { Icon } from './Icon'
import './dialogs.css'

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
  if (!open || !system) return null

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-settings-title"
      data-testid="system-settings-dialog"
    >
      <div className="dialog dialog--workspace dialog--system-settings">
        <header className="dialog__header system-settings-dialog__header">
          <h2 id="system-settings-title">System settings</h2>
          <span className="system-settings-dialog__tools" ref={setToolsSlot} />
          <button
            className="icon-btn dialog__close"
            onClick={onClose}
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
        />
      </div>
    </div>
  )
}
