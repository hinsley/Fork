import { Icon } from './Icon'

/** App-level error, rendered above dialogs so failures inside modals stay visible. */
export function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="toast toast--error" role="alert" data-testid="error-toast">
      <span className="toast__message">{message}</span>
      <button
        type="button"
        className="icon-btn icon-btn--sm toast__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}
