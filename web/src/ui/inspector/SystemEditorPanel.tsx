import { useEffect, useMemo, useReducer, useRef, useState, type SetStateAction } from 'react'
import type { SystemConfig } from '../../system/types'
import { parseConstantExpression } from '../../system/constantExpression'
import {
  EXPRESSION_COMPARISONS,
  EXPRESSION_CONSTANTS,
  EXPRESSION_FUNCTION_GROUPS,
  PIECEWISE_EXPRESSION_FUNCTIONS,
} from '../../system/expressionLanguage'
import { validateSystemConfig } from '../../state/systemValidation'
import {
  DEFAULT_VARIABLE_PERIOD,
  normalizePeriodicVariables,
  parsePeriodExpression,
} from '../../system/periodicity'
import type { SystemStringDefinition } from '../../system/systemString'
import { normalizePeriodicForcing } from '../../system/forcing'
import { Icon } from '../Icon'
import { SystemStringTools } from './SystemStringTools'
import { systemConfigsEqual } from './systemConfigEquality'
import type { SystemEditorActions } from './types'

const FLOW_SOLVERS = ['rk4', 'tsit5']

type SystemDraft = {
  name: string
  type: 'flow' | 'map'
  solver: string
  varNames: string[]
  paramNames: string[]
  params: string[]
  equations: string[]
  periodicVariables: Array<{ enabled: boolean; period: string }>
  periodicForcingEnabled: boolean
  flowPeriodExpression: string
  mapIterationPeriod: string
}

type EditorState = {
  draft: SystemDraft
  touched: boolean
  equationErrors: Array<string | null>
  message: string | null
  validating: boolean
}

type EditorAction =
  | { type: 'set-draft'; update: SetStateAction<SystemDraft> }
  | { type: 'touch' }
  | { type: 'validation-started' }
  | { type: 'validation-finished'; equationErrors: Array<string | null>; message: string | null }
  | { type: 'validation-failed'; message: string }
  | { type: 'clear-validation' }

function adjustArray<T>(values: T[], targetLength: number, fill: () => T): T[] {
  const next = values.slice(0, targetLength)
  while (next.length < targetLength) next.push(fill())
  return next
}

const defaultPeriodic = () => ({ enabled: false, period: String(DEFAULT_VARIABLE_PERIOD) })

function makeDraft(config: SystemConfig): SystemDraft {
  const periodic = normalizePeriodicVariables(config)
  const forcing = normalizePeriodicForcing(config)
  return {
    name: config.name,
    type: config.type,
    solver: config.type === 'map' ? 'discrete' : config.solver,
    varNames: [...config.varNames],
    paramNames: [...config.paramNames],
    params: config.params.map(String),
    equations: [...config.equations],
    periodicVariables: config.varNames.map((_, index) => ({
      enabled: periodic[index]?.enabled ?? false,
      period: String(periodic[index]?.period ?? DEFAULT_VARIABLE_PERIOD),
    })),
    periodicForcingEnabled: Boolean(forcing),
    flowPeriodExpression: forcing?.symbol === 't' ? forcing.periodExpression : 'tau',
    mapIterationPeriod: forcing?.symbol === 'n' ? String(forcing.iterationPeriod) : '2',
  }
}

function createState(config: SystemConfig): EditorState {
  return {
    draft: makeDraft(config),
    touched: false,
    equationErrors: [],
    message: null,
    validating: false,
  }
}

function systemEditorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'set-draft':
      return {
        ...state,
        draft:
          typeof action.update === 'function'
            ? action.update(state.draft)
            : action.update,
      }
    case 'touch':
      return { ...state, touched: true }
    case 'validation-started':
      return { ...state, validating: true }
    case 'validation-finished':
      return {
        ...state,
        validating: false,
        equationErrors: action.equationErrors,
        message: action.message,
      }
    case 'validation-failed':
      return { ...state, validating: false, message: action.message }
    case 'clear-validation':
      return { ...state, validating: false, equationErrors: [], message: null }
  }
}

function buildConfig(draft: SystemDraft): SystemConfig {
  const varNames = draft.varNames.map((name) => name.trim())
  return {
    name: draft.name.trim(),
    type: draft.type,
    solver: draft.type === 'map' ? 'discrete' : draft.solver,
    varNames,
    equations: draft.equations.map((equation) => equation.trim()),
    paramNames: draft.paramNames.map((name) => name.trim()),
    params: draft.params.map((value) => parseConstantExpression(value) ?? Number.NaN),
    periodicVariables: adjustArray(draft.periodicVariables, varNames.length, defaultPeriodic).map(
      (entry) => ({
        enabled: entry.enabled,
        period: parsePeriodExpression(entry.period) ?? Number.NaN,
      })
    ),
    periodicForcing: !draft.periodicForcingEnabled
      ? undefined
      : draft.type === 'flow'
        ? { symbol: 't', periodExpression: draft.flowPeriodExpression.trim() }
        : { symbol: 'n', iterationPeriod: Number(draft.mapIterationPeriod) },
  }
}

function configKey(config: SystemConfig): string {
  return JSON.stringify({ ...config, periodicVariables: normalizePeriodicVariables(config), periodicForcing: normalizePeriodicForcing(config) })
}

function formatValues(values: string[]): string {
  return values.join(', ')
}

function parseValues(value: string): number[] {
  const expressions = value
    .split(/[,\r\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  const evaluated = expressions.map(parseConstantExpression)
  if (evaluated.length > 0 && evaluated.every((entry) => entry !== null)) {
    return evaluated as number[]
  }
  return (value.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [])
    .map(Number)
    .filter(Number.isFinite)
}

function ExpressionLanguageReference({ systemType }: { systemType: 'flow' | 'map' }) {
  return (
    <div className="system-editor__reference" role="note">
      <p>
        Backtick names with spaces: <code>`my var`</code>. {systemType === 'map' ? (
          <><code>n</code> = iteration.</>
        ) : (
          <><code>t</code> = time.</>
        )}{' '}
        Constants:{' '}
        {EXPRESSION_CONSTANTS.map((constant) => (
          <code key={constant}>{constant}</code>
        ))}
        . Parameter values accept constant expressions (<code>tau / 4</code>).
      </p>
      <div className="system-editor__expression-groups">
        {EXPRESSION_FUNCTION_GROUPS.map((group) => (
          <div key={group.label}>
            <strong>{group.label}</strong>
            <span>
              {group.functions.map((signature) => (
                <code key={signature}>{signature}</code>
              ))}
            </span>
          </div>
        ))}
        <div>
          <strong>Comparisons</strong>
          <span>
            {EXPRESSION_COMPARISONS.map((operator) => (
              <code key={operator}>{operator}</code>
            ))}
          </span>
        </div>
        <div>
          <strong>Piecewise</strong>
          <span>
            {PIECEWISE_EXPRESSION_FUNCTIONS.map((signature) => (
              <code key={signature}>{signature}</code>
            ))}
          </span>
        </div>
      </div>
      <p className="field-warning">
        Piecewise functions are not differentiable at jumps, ties, or corners; avoid those points in
        continuation and normal forms.
      </p>
    </div>
  )
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value)
}

async function readText(): Promise<string | null> {
  if (!navigator.clipboard?.readText) return null
  return navigator.clipboard.readText()
}

type SystemEditorPanelProps = {
  systemId: string
  config: SystemConfig
  actions: SystemEditorActions
  /** Optional element (e.g. a dialog header) that receives the Import/Copy buttons. */
  toolsContainer?: HTMLElement | null
  /** Reports whether the draft differs from the applied config. */
  onDirtyChange?: (dirty: boolean) => void
}

export function SystemEditorPanel(props: SystemEditorPanelProps) {
  const key = `${props.systemId}:${configKey(props.config)}`
  return <SystemEditorSession key={key} {...props} />
}

function ParameterMenu({
  disabled,
  onCopy,
  onPaste,
}: {
  disabled: boolean
  onCopy: () => void
  onPaste: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return
      setOpen(false)
    }
    // Capture phase: Esc closes this menu before it can close the surrounding dialog.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])
  return (
    <span className="system-editor__menu" ref={ref}>
      <button
        type="button"
        className="icon-btn icon-btn--sm"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Parameter value actions"
        title="Copy / paste values"
        data-testid="system-param-menu"
      >
        <Icon name="more" size={14} />
      </button>
      {open ? (
        <span className="menu-surface system-editor__menu-list" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onCopy() }}>
            Copy values
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onPaste() }}>
            Paste values
          </button>
        </span>
      ) : null}
    </span>
  )
}

function SystemEditorSession({
  config,
  actions,
  toolsContainer,
  onDirtyChange,
}: SystemEditorPanelProps) {
  const [state, dispatch] = useReducer(systemEditorReducer, config, createState)
  const [referenceOpen, setReferenceOpen] = useState(false)
  const { draft } = state
  const systemConfig = useMemo(() => buildConfig(draft), [draft])
  const validation = useMemo(() => validateSystemConfig(systemConfig), [systemConfig])
  const dirty = useMemo(() => !systemConfigsEqual(systemConfig, config), [config, systemConfig])
  const showErrors = state.touched || dirty || !validation.valid

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const setDraft = (update: SetStateAction<SystemDraft>) =>
    dispatch({ type: 'set-draft', update })

  useEffect(() => {
    if (!dirty && !state.touched) {
      dispatch({ type: 'clear-validation' })
      return
    }
    if (!validation.valid) {
      dispatch({ type: 'clear-validation' })
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      dispatch({ type: 'validation-started' })
      try {
        const result = await actions.validateSystem(systemConfig, { signal: controller.signal })
        if (!controller.signal.aborted) {
          dispatch({
            type: 'validation-finished',
            equationErrors: result.equationErrors ?? [],
            message: result.message ?? null,
          })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          dispatch({ type: 'validation-failed', message: String(error) })
        }
      }
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [actions, dirty, state.touched, systemConfig, validation.valid])

  const apply = async () => {
    dispatch({ type: 'touch' })
    if (!validation.valid) return
    dispatch({ type: 'validation-started' })
    try {
      const result = await actions.validateSystem(systemConfig)
      dispatch({
        type: 'validation-finished',
        equationErrors: result.equationErrors ?? [],
        message: result.message ?? null,
      })
      if (!result.ok || result.equationErrors.some(Boolean)) return
      await actions.updateSystem(systemConfig)
    } catch (error) {
      dispatch({ type: 'validation-failed', message: String(error) })
    }
  }

  const setType = (type: SystemDraft['type']) => {
    setDraft((previous) => ({
      ...previous,
      type,
      solver: type === 'map' ? 'discrete' : FLOW_SOLVERS.includes(previous.solver) ? previous.solver : 'rk4',
      periodicForcingEnabled: false,
    }))
  }

  const pasteParameters = async () => {
    const text = await readText()
    if (!text) return
    const values = parseValues(text)
    if (values.length === 0) return
    setDraft((previous) => ({
      ...previous,
      params: previous.paramNames.map((_, index) => String(values[index] ?? 0)),
    }))
  }

  const replaceFromSystemString = (definition: SystemStringDefinition) => {
    setDraft((previous) => ({
      ...previous,
      varNames: definition.varNames,
      equations: definition.equations,
      paramNames: definition.paramNames,
      params: definition.params.map(String),
      periodicVariables: definition.varNames.map(defaultPeriodic),
    }))
    dispatch({ type: 'clear-validation' })
  }

  const updatePeriodic = (index: number, update: Partial<SystemDraft['periodicVariables'][number]>) =>
    setDraft((previous) => ({
      ...previous,
      periodicVariables: adjustArray(previous.periodicVariables, previous.varNames.length, defaultPeriodic).map(
        (value, current) => (current === index ? { ...value, ...update } : value)
      ),
    }))

  const isMap = draft.type === 'map'

  return (
    <div className="inspector-panel system-editor" data-testid="inspector-panel-body">
      <div className="system-editor__scroll">
        <SystemStringTools
          definition={systemConfig}
          canCopy={validation.valid}
          onImport={replaceFromSystemString}
          actionsContainer={toolsContainer}
        />

        <div className="system-editor__model">
          <input
            className="system-editor__name"
            value={draft.name}
            aria-label="System name"
            placeholder="Name"
            onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
            data-testid="system-name"
          />
          <div className="system-type-switch" role="group" aria-label="System type" data-testid="system-type">
            <button type="button" className={!isMap ? 'is-active' : undefined} aria-pressed={!isMap} title="Ordinary differential equations" onClick={() => setType('flow')} data-testid="system-type-flow">Flow</button>
            <button type="button" className={isMap ? 'is-active' : undefined} aria-pressed={isMap} title="Discrete map (iterated update)" onClick={() => setType('map')} data-testid="system-type-map">Map</button>
          </div>
          {!isMap ? (
            <select
              className="system-editor__solver"
              value={draft.solver}
              aria-label="Solver"
              title="Solver"
              onChange={(event) => setDraft((previous) => ({ ...previous, solver: event.target.value }))}
              data-testid="system-solver"
            >
              {FLOW_SOLVERS.map((solver) => <option key={solver} value={solver}>{solver}</option>)}
            </select>
          ) : null}
          <label className="system-editor__check" data-testid="system-periodic-forcing">
            <input
              type="checkbox"
              checked={draft.periodicForcingEnabled}
              onChange={(event) => setDraft((previous) => ({ ...previous, periodicForcingEnabled: event.target.checked }))}
              data-testid="system-periodic-forcing-enabled"
            />
            Periodic forcing
          </label>
        </div>
        {showErrors && validation.errors.name ? <div className="field-error">{validation.errors.name}</div> : null}
        {draft.periodicForcingEnabled ? (
          <div className="system-editor__forcing">
            {!isMap ? (
              <label>
                <span>Period</span>
                <input
                  value={draft.flowPeriodExpression}
                  placeholder="tau / omega"
                  onChange={(event) => setDraft((previous) => ({ ...previous, flowPeriodExpression: event.target.value }))}
                  data-testid="system-forcing-period-expression"
                />
              </label>
            ) : (
              <label>
                <span>Period (iterations)</span>
                <input
                  type="number"
                  step="1"
                  value={draft.mapIterationPeriod}
                  onChange={(event) => setDraft((previous) => ({ ...previous, mapIterationPeriod: event.target.value }))}
                  data-testid="system-forcing-iteration-period"
                />
              </label>
            )}
            {showErrors && validation.errors.periodicForcing ? <span className="field-error" data-testid="system-periodic-forcing-error">{validation.errors.periodicForcing}</span> : null}
          </div>
        ) : null}
        {validation.warnings.length > 0 ? <div className="field-warning system-editor__message">{validation.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : null}

        <section className="system-editor__section system-editor__variables">
          <h3 className="section-head">
            <span className="system-editor__head-title">
              Variables
              <button
                type="button"
                className={`icon-btn icon-btn--sm${referenceOpen ? ' is-active' : ''}`}
                onClick={() => setReferenceOpen((open) => !open)}
                aria-expanded={referenceOpen}
                aria-label="Expression syntax and functions"
                title="Expression syntax and functions"
                data-testid="expression-reference"
              >
                <Icon name="help" size={14} />
              </button>
            </span>
            <button type="button" className="btn btn--ghost system-editor__add-button" onClick={() => setDraft((previous) => ({ ...previous, varNames: [...previous.varNames, `x${previous.varNames.length + 1}`], equations: [...previous.equations, ''], periodicVariables: [...previous.periodicVariables, defaultPeriodic()] }))} data-testid="system-add-variable"><Icon name="plus" size={13} /> Variable</button>
          </h3>
          {referenceOpen ? <ExpressionLanguageReference systemType={draft.type} /> : null}
          {showErrors && validation.errors.varNames ? <div className="field-error">{validation.errors.varNames}</div> : null}
          <div className="system-editor__variable-list">
            {draft.varNames.length > 0 ? (
              <div className="system-editor__variable-head" aria-hidden="true">
                <span />
                <span />
                <span>Periodic</span>
                <span />
              </div>
            ) : null}
            {draft.varNames.map((name, index) => {
              const label = name || `x${index + 1}`
              const periodic = draft.periodicVariables[index]
              const equationError = state.equationErrors[index] ?? (state.touched ? validation.errors.equations?.[index] : null)
              return (
                <div className="system-editor__variable-row" key={`variable-${index}`}>
                  <input className="system-editor__var-name" value={name} aria-label={`Variable ${index + 1} name`} onChange={(event) => setDraft((previous) => ({ ...previous, varNames: previous.varNames.map((value, current) => current === index ? event.target.value : value) }))} data-testid={`system-var-${index}`} />
                  <div className="system-editor__equation-input">
                    <span aria-hidden="true">{isMap ? `${label}ₙ₊₁` : `${label}′`} =</span>
                    <textarea rows={1} value={draft.equations[index] ?? ''} aria-label={`${label} equation`} spellCheck={false} onChange={(event) => setDraft((previous) => ({ ...previous, equations: adjustArray(previous.equations, previous.varNames.length, () => '').map((value, current) => current === index ? event.target.value : value) }))} data-testid={`system-eq-${index}`} />
                  </div>
                  <span className="system-editor__periodic">
                    <input type="checkbox" checked={Boolean(periodic?.enabled)} aria-label={`${label} periodic`} title={`Periodic ${label}`} onChange={(event) => updatePeriodic(index, { enabled: event.target.checked })} data-testid={`system-periodic-enabled-${index}`} />
                    {periodic?.enabled ? <input className="system-editor__period" value={periodic.period} aria-label={`${label} period`} title="Period" onChange={(event) => updatePeriodic(index, { period: event.target.value })} data-testid={`system-periodic-period-${index}`} /> : null}
                  </span>
                  <button type="button" className="icon-btn icon-btn--sm system-editor__remove-button" aria-label={`Remove ${label}`} title="Remove" onClick={() => setDraft((previous) => ({ ...previous, varNames: previous.varNames.filter((_, current) => current !== index), equations: previous.equations.filter((_, current) => current !== index), periodicVariables: previous.periodicVariables.filter((_, current) => current !== index) }))} data-testid={`system-remove-var-${index}`}><Icon name="close" size={13} /></button>
                  {equationError ? <span className="field-error system-editor__row-error" data-testid={state.equationErrors[index] ? `system-eq-error-${index}` : undefined}>{equationError}</span> : null}
                  {periodic?.enabled && showErrors && validation.errors.periodicVariables?.[index] ? <span className="field-error system-editor__row-error" data-testid={`system-periodic-error-${index}`}>{validation.errors.periodicVariables[index]}</span> : null}
                </div>
              )
            })}
          </div>
        </section>

        <section className="system-editor__section system-editor__parameters">
          <h3 className="section-head">
            <span className="system-editor__head-title">
              Parameters
              <ParameterMenu
                disabled={draft.paramNames.length === 0}
                onCopy={() => void copyText(formatValues(draft.params))}
                onPaste={() => void pasteParameters()}
              />
            </span>
            <button type="button" className="btn btn--ghost system-editor__add-button" onClick={() => setDraft((previous) => ({ ...previous, paramNames: [...previous.paramNames, `p${previous.paramNames.length + 1}`], params: [...previous.params, '0'] }))} data-testid="system-add-parameter"><Icon name="plus" size={13} /> Parameter</button>
          </h3>
          {showErrors && validation.errors.paramNames ? <div className="field-error">{validation.errors.paramNames}</div> : null}
          {draft.paramNames.length > 0 ? (
            <div className="system-editor__parameter-list">
              {draft.paramNames.map((name, index) => {
                const valueError = showErrors ? validation.errors.params?.[index] : null
                return (
                  <div className={`system-editor__parameter-row${valueError ? ' is-invalid' : ''}`} key={`parameter-${index}`} title={valueError ?? undefined}>
                    <input className="system-editor__param-name" value={name} aria-label={`Parameter ${index + 1} name`} onChange={(event) => setDraft((previous) => ({ ...previous, paramNames: previous.paramNames.map((value, current) => current === index ? event.target.value : value) }))} data-testid={`system-param-${index}`} />
                    <span className="system-editor__equals" aria-hidden="true">=</span>
                    <input className="system-editor__param-value" type="text" inputMode="text" placeholder="0" value={draft.params[index] ?? ''} aria-label={`${name || `Parameter ${index + 1}`} value`} aria-invalid={valueError ? true : undefined} onChange={(event) => setDraft((previous) => ({ ...previous, params: adjustArray(previous.params, previous.paramNames.length, () => '0').map((value, current) => current === index ? event.target.value : value) }))} data-testid={`system-param-value-${index}`} />
                    <button type="button" className="icon-btn icon-btn--sm system-editor__remove-button" aria-label={`Remove ${name || `parameter ${index + 1}`}`} title="Remove" onClick={() => setDraft((previous) => ({ ...previous, paramNames: previous.paramNames.filter((_, current) => current !== index), params: previous.params.filter((_, current) => current !== index) }))} data-testid={`system-remove-param-${index}`}><Icon name="close" size={13} /></button>
                  </div>
                )
              })}
            </div>
          ) : null}
        </section>
      </div>
      <footer className="system-editor__footer">
        <div className="system-editor__status" aria-live="polite">
          {state.message ? <div className="field-error">{state.message}</div> : null}
          {state.validating ? <div className="field-warning">Validating equations…</div> : null}
          {!state.message && !state.validating && dirty ? <span className="muted">Unsaved changes</span> : null}
        </div>
        <button className="btn btn--primary system-editor__apply" onClick={() => void apply()} disabled={state.validating || !dirty} data-testid="system-apply">Apply</button>
      </footer>
    </div>
  )
}
