import type { ReactNode } from 'react'
import { fmt } from '../../../utils/format'
import { CopyButton, KeyValues } from '../InspectorChrome'

/** `lc1_p1 @ 20` → `lc1_p1 #20`. */
function formatRenderTarget(label: string): string {
  return label.replace(/ @ (\S+)$/, ' #$1')
}

export function StateVector({
  names,
  values,
  onCopy,
  title = 'State',
  testId,
}: {
  names: string[]
  values: number[]
  onCopy?: () => void
  title?: string
  testId?: string
}) {
  return (
    <div className="inspector-glance__group" data-testid={testId}>
      <div className="section-head">
        <span>{title}</span>
        {onCopy ? <CopyButton onCopy={onCopy} label={`Copy ${title.toLowerCase()}`} /> : null}
      </div>
      <KeyValues
        columns={values.length > 1 ? 2 : 1}
        rows={values.map((value, index) => ({
          label: names[index] ?? `x${index + 1}`,
          value: fmt(value),
        }))}
      />
    </div>
  )
}

export function ValueList({
  title,
  values,
  testId,
}: {
  title: ReactNode
  values: string[]
  testId?: string
}) {
  if (values.length === 0) return null
  return (
    <div className="inspector-glance__group" data-testid={testId}>
      <div className="section-head">
        <span>{title}</span>
      </div>
      <ul className="inspector-value-list num">
        {values.map((value, index) => (
          <li key={`${value}-${index}`}>{value}</li>
        ))}
      </ul>
    </div>
  )
}

export function RenderTargetChip({
  label,
  onReset,
  resetTitle,
  testId,
  resetTestId,
}: {
  label: string
  onReset?: () => void
  resetTitle: string
  testId: string
  resetTestId: string
}) {
  return (
    <div className="inspector-render-target" data-testid={testId}>
      <span className="chip" title={`Rendered at ${label}`}>
        @ {formatRenderTarget(label)}
      </span>
      {onReset ? (
        <button
          type="button"
          className="btn btn--ghost inspector-render-target__reset"
          onClick={onReset}
          title={resetTitle}
          data-testid={resetTestId}
        >
          ↺ stored
        </button>
      ) : null}
    </div>
  )
}
