import { SystemEditorPanel } from './inspector/SystemEditorPanel'
import type { System } from '../system/types'
import type { SystemEditorActions } from './inspector/types'

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
          <div className="system-settings-dialog__heading">
            <h2 id="system-settings-title">System settings</h2>
            <span className="dialog__context">{system.config.name}</span>
          </div>
          <button
            className="dialog__close"
            onClick={onClose}
            aria-label="Close system settings"
            data-testid="close-system-settings"
          >
            ✕
          </button>
        </header>
        <div className="dialog__section dialog__section--flush">
          <SystemEditorPanel
            systemId={system.id}
            config={system.config}
            actions={actions}
          />
        </div>
      </div>
    </div>
  )
}
