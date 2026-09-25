import { useEffect, useRef, useState } from 'react'
import type { SystemConfig } from '../system/types'
import { parseConstantExpression } from '../system/constantExpression'
import { validateSystemConfig } from '../state/systemValidation'

type ParameterStripProps = {
  config: SystemConfig
  onUpdateSystem?: (config: SystemConfig) => Promise<void> | void
}

function firstValidationMessage(errors: Record<string, unknown>): string | null {
  for (const value of Object.values(errors)) {
    if (typeof value === 'string' && value) return value
    if (Array.isArray(value)) {
      const message = value.find((entry) => typeof entry === 'string' && entry)
      if (message) return message
    }
  }
  return null
}

/**
 * One line of editable system parameter values shown above the viewports.
 * Commits go through the same validation and `updateSystem` path as the
 * System Settings dialog (constant expressions such as `tau / 4` are accepted).
 */
export function ParameterStrip({ config, onUpdateSystem }: ParameterStripProps) {
  if (config.paramNames.length === 0) return null
  return (
    <div className="param-strip" role="group" aria-label="Parameters" data-testid="param-strip">
      {config.paramNames.map((name, index) => (
        <ParameterField
          key={`${index}:${name}`}
          index={index}
          name={name}
          config={config}
          onUpdateSystem={onUpdateSystem}
        />
      ))}
    </div>
  )
}

function ParameterField({
  index,
  name,
  config,
  onUpdateSystem,
}: {
  index: number
  name: string
  config: SystemConfig
  onUpdateSystem?: ParameterStripProps['onUpdateSystem']
}) {
  const value = config.params[index]
  const current = Number.isFinite(value) ? String(value) : ''
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = draft ?? current
  const readOnly = !onUpdateSystem
  const cancelBlurCommit = useRef(false)
  // Brief red flash after an invalid draft is reverted on blur.
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(false), 900)
    return () => window.clearTimeout(timer)
  }, [flash])

  const reset = () => {
    setDraft(null)
    setError(null)
  }

  /**
   * Enter keeps an invalid draft (red, reason in the tooltip) so it can be fixed;
   * blur reverts it to the committed value so the field never disagrees with the system.
   */
  const commit = (source: 'enter' | 'blur') => {
    if (draft === null) return
    const reject = (message: string) => {
      if (source === 'blur') {
        reset()
        setFlash(true)
        return
      }
      setError(message)
    }
    const parsed = parseConstantExpression(draft)
    if (parsed === null || !Number.isFinite(parsed)) {
      reject('Enter a finite number or constant expression (e.g. tau / 4).')
      return
    }
    if (parsed === value) {
      reset()
      return
    }
    const next: SystemConfig = {
      ...config,
      params: config.params.map((entry, current) => (current === index ? parsed : entry)),
    }
    const validation = validateSystemConfig(next)
    if (!validation.valid) {
      reject(firstValidationMessage(validation.errors) ?? 'Invalid parameter value.')
      return
    }
    reset()
    void onUpdateSystem?.(next)
  }

  return (
    <label
      className={`param-strip__item${error || flash ? ' is-invalid' : ''}${draft !== null ? ' is-dirty' : ''}`}
      title={error ?? `${name} = ${current}`}
    >
      <span className="param-strip__name">{name}</span>
      <input
        className="param-strip__input"
        value={shown}
        readOnly={readOnly}
        spellCheck={false}
        autoComplete="off"
        aria-label={`Parameter ${name}`}
        aria-invalid={error ? true : undefined}
        style={{ width: `calc(${Math.min(16, Math.max(3, shown.length)) + 1}ch + 12px)` }}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(null)
          setFlash(false)
        }}
        onFocus={(event) => event.target.select()}
        onBlur={() => {
          if (cancelBlurCommit.current) {
            cancelBlurCommit.current = false
            return
          }
          commit('blur')
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit('enter')
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            reset()
            cancelBlurCommit.current = true
            event.currentTarget.blur()
          }
        }}
        data-testid={`param-strip-value-${index}`}
      />
    </label>
  )
}
