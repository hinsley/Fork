import { Icon } from '../Icon'
import { adjustArray } from './stateTableValues'

type StateTableProps = {
  title: string
  varNames: string[]
  values: string[]
  onChange: (next: string[]) => void
  onCopy: () => void
  onPaste: () => void
  emptyMessage?: string
  testIdPrefix?: string
}

export function StateTable({
  title,
  varNames,
  values,
  onChange,
  onCopy,
  onPaste,
  emptyMessage,
  testIdPrefix,
}: StateTableProps) {
  const resolvedValues = adjustArray(values, varNames.length, () => '0')
  const hasVars = varNames.length > 0
  return (
    <div className="state-table">
      <div className="state-table__header">
        <span className="state-table__title">{title}</span>
        <div className="state-table__actions">
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            onClick={onCopy}
            disabled={!hasVars}
            aria-label="Copy"
            title="Copy"
          >
            <Icon name="copy" size={13} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            onClick={onPaste}
            disabled={!hasVars}
            aria-label="Paste"
            title="Paste"
          >
            <Icon name="download" size={13} />
          </button>
        </div>
      </div>
      {hasVars ? (
        <div className="state-table__wrap" role="region" aria-label={title}>
          <table className="state-table__grid">
            <thead>
              <tr>
                {varNames.map((name, index) => (
                  <th key={`state-head-${index}`}>{name || `x${index + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {resolvedValues.map((value, index) => (
                  <td key={`state-cell-${index}`}>
                    <input
                      type="number"
                      step="any"
                      className="state-table__input"
                      value={value ?? ''}
                      onChange={(event) => {
                        const next = [...resolvedValues]
                        next[index] = event.target.value
                        onChange(next)
                      }}
                      data-testid={testIdPrefix ? `${testIdPrefix}-${index}` : undefined}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">{emptyMessage ?? '—'}</p>
      )}
    </div>
  )
}
