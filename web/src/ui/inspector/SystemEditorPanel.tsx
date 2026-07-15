import { useEffect, useMemo, useReducer, type SetStateAction } from 'react'
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
import { SystemStringTools } from './SystemStringTools'
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
  sections: Record<'model' | 'variables' | 'parameters', boolean>
  touched: boolean
  equationErrors: Array<string | null>
  message: string | null
  validating: boolean
}

type EditorAction =
  | { type: 'set-draft'; update: SetStateAction<SystemDraft> }
  | { type: 'toggle-section'; section: keyof EditorState['sections'] }
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
    sections: { model: true, variables: true, parameters: true },
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
    case 'toggle-section':
      return {
        ...state,
        sections: { ...state.sections, [action.section]: !state.sections[action.section] },
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
    periodicVariables: adjustArray(
      draft.periodicVariables,
      varNames.length,
      () => ({ enabled: false, period: String(DEFAULT_VARIABLE_PERIOD) })
    ).map((entry) => ({
      enabled: entry.enabled,
      period: parsePeriodExpression(entry.period) ?? Number.NaN,
    })),
    periodicForcing: !draft.periodicForcingEnabled
      ? undefined
      : draft.type === 'flow'
        ? { symbol: 't', periodExpression: draft.flowPeriodExpression.trim() }
        : { symbol: 'n', iterationPeriod: Number(draft.mapIterationPeriod) },
  }
}

function configsEqual(left: SystemConfig, right: SystemConfig): boolean {
  return JSON.stringify({ ...left, periodicVariables: normalizePeriodicVariables(left), periodicForcing: normalizePeriodicForcing(left) }) ===
    JSON.stringify({ ...right, periodicVariables: normalizePeriodicVariables(right), periodicForcing: normalizePeriodicForcing(right) })
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
    <details className="system-editor__expression-reference" data-testid="expression-reference">
      <summary>Expression syntax and functions</summary>
      <div className="system-editor__expression-reference-body">
        <p>
          Use variable and parameter names with <code>+</code>, <code>-</code>, <code>*</code>,{' '}
          <code>/</code>, <code>^</code>, parentheses, and scientific notation such as{' '}
          <code>1e-3</code>.
        </p>
        <p>
          {systemType === 'map' ? (
            <>
              Use <code>n</code> for the current map iteration. It starts at the orbit&apos;s{' '}
              <code>n₀</code> and advances by one per iterate.
            </>
          ) : (
            <>
              Use <code>t</code> for the current flow time. Runge–Kutta stages evaluate it at their
              stage times.
            </>
          )}{' '}
          Declared variables or parameters with that name take precedence. Parameter values remain
          constant expressions and cannot use the contextual symbol.
        </p>
        <p>
          Built-in constants:{' '}
          {EXPRESSION_CONSTANTS.map((constant, index) => (
            <span key={constant}>
              {index > 0 ? ', ' : ''}<code>{constant}</code>
            </span>
          ))}. Parameter values also accept finite constant expressions such as{' '}
          <code>tau / 4</code>.
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
          Piecewise functions are differentiated on their current branch but are not differentiable
          at jumps, ties, or corners. Avoid those points in continuation and normal-form calculations.
        </p>
      </div>
    </details>
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
}

export function SystemEditorPanel(props: SystemEditorPanelProps) {
  const key = `${props.systemId}:${configKey(props.config)}`
  return <SystemEditorSession key={key} {...props} />
}

function SystemEditorSession({ config, actions }: SystemEditorPanelProps) {
  const [state, dispatch] = useReducer(systemEditorReducer, config, createState)
  const { draft, sections } = state
  const systemConfig = useMemo(() => buildConfig(draft), [draft])
  const validation = useMemo(() => validateSystemConfig(systemConfig), [systemConfig])
  const dirty = useMemo(() => !configsEqual(systemConfig, config), [config, systemConfig])
  const showErrors = state.touched || dirty || !validation.valid

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

  const toggle = (section: keyof EditorState['sections']) =>
    dispatch({ type: 'toggle-section', section })

  const replaceFromSystemString = (definition: SystemStringDefinition) => {
    setDraft((previous) => ({
      ...previous,
      varNames: definition.varNames,
      equations: definition.equations,
      paramNames: definition.paramNames,
      params: definition.params.map(String),
      periodicVariables: definition.varNames.map(() => ({
        enabled: false,
        period: String(DEFAULT_VARIABLE_PERIOD),
      })),
    }))
    dispatch({ type: 'clear-validation' })
  }

  return (
    <div className="inspector-panel system-editor" data-testid="inspector-panel-body">
      <div className="system-editor__scroll">
        <SystemStringTools
          definition={systemConfig}
          canCopy={validation.valid}
          onImport={replaceFromSystemString}
        />
        <section className={`inspector-section system-editor__card${sections.model ? '' : ' is-collapsed'}`}>
          <header className="system-editor__card-header">
            <button type="button" className="system-editor__section-toggle" aria-expanded={sections.model} onClick={() => toggle('model')} data-testid="system-toggle-model">
              <span aria-hidden="true">{sections.model ? '▾' : '▸'}</span>
              <span className="system-editor__section-copy">
                <span className="system-editor__eyebrow">Definition</span>
                <span className="system-editor__section-title">Model</span>
              </span>
            </button>
            <div className="system-editor__counts"><span>{draft.varNames.length} variables</span><span>{draft.paramNames.length} parameters</span></div>
          </header>
          {sections.model ? (
            <div className="system-editor__card-body">
              <div className={`system-editor__model-grid system-editor__model-grid--${draft.type}`}>
                <label className="system-editor__field system-editor__field--name">
                  <span>System name</span>
                  <input value={draft.name} onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))} data-testid="system-name" />
                  {showErrors && validation.errors.name ? <span className="field-error">{validation.errors.name}</span> : null}
                </label>
                <div className="system-editor__field system-editor__field--type">
                  <span>System type</span>
                  <div className="system-type-switch" role="group" aria-label="System type" data-testid="system-type">
                    <button type="button" className={draft.type === 'flow' ? 'is-active' : undefined} aria-pressed={draft.type === 'flow'} onClick={() => setType('flow')} data-testid="system-type-flow"><strong>Flow</strong><span>ODE · continuous time</span></button>
                    <button type="button" className={draft.type === 'map' ? 'is-active' : undefined} aria-pressed={draft.type === 'map'} onClick={() => setType('map')} data-testid="system-type-map"><strong>Discrete map</strong><span>Iterated update</span></button>
                  </div>
                </div>
                {draft.type === 'flow' ? (
                  <label className="system-editor__field system-editor__field--solver">
                    <span>Integrator</span>
                    <select value={draft.solver} onChange={(event) => setDraft((previous) => ({ ...previous, solver: event.target.value }))} data-testid="system-solver">
                      {FLOW_SOLVERS.map((solver) => <option key={solver} value={solver}>{solver}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
              {validation.warnings.length > 0 ? <div className="field-warning system-editor__message">{validation.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : null}
              <div className="periodic-control system-editor__forcing" data-testid="system-periodic-forcing">
                <label className="periodic-control__toggle">
                  <input
                    type="checkbox"
                    checked={draft.periodicForcingEnabled}
                    onChange={(event) => setDraft((previous) => ({ ...previous, periodicForcingEnabled: event.target.checked }))}
                    data-testid="system-periodic-forcing-enabled"
                  />
                  Periodic forcing
                </label>
                {draft.periodicForcingEnabled ? (
                  draft.type === 'flow' ? (
                    <label className="system-editor__field">
                      <span>Forcing period expression</span>
                      <input
                        value={draft.flowPeriodExpression}
                        placeholder="e.g. tau / omega"
                        onChange={(event) => setDraft((previous) => ({ ...previous, flowPeriodExpression: event.target.value }))}
                        data-testid="system-forcing-period-expression"
                      />
                    </label>
                  ) : (
                    <label className="system-editor__field">
                      <span>Forcing period (iterations)</span>
                      <input
                        type="number"
                        step="1"
                        value={draft.mapIterationPeriod}
                        onChange={(event) => setDraft((previous) => ({ ...previous, mapIterationPeriod: event.target.value }))}
                        data-testid="system-forcing-iteration-period"
                      />
                    </label>
                  )
                ) : null}
                {showErrors && validation.errors.periodicForcing ? <span className="field-error" data-testid="system-periodic-forcing-error">{validation.errors.periodicForcing}</span> : null}
                {draft.periodicForcingEnabled ? <span className="field-warning">This declares the forcing periodicity used by stroboscopic response analysis; Fork does not infer it from the equations.</span> : null}
              </div>
            </div>
          ) : null}
        </section>

        <div className="system-editor__workspace">
          <section className={`inspector-section system-editor__card system-editor__variables${sections.variables ? '' : ' is-collapsed'}`}>
            <header className="system-editor__card-header">
              <button type="button" className="system-editor__section-toggle" aria-expanded={sections.variables} onClick={() => toggle('variables')} data-testid="system-toggle-variables">
                <span aria-hidden="true">{sections.variables ? '▾' : '▸'}</span>
                <span className="system-editor__section-copy"><span className="system-editor__eyebrow">State space</span><span className="system-editor__section-title">Variables and equations</span></span>
              </button>
              <button type="button" className="system-editor__add-button" onClick={() => setDraft((previous) => ({ ...previous, varNames: [...previous.varNames, `x${previous.varNames.length + 1}`], equations: [...previous.equations, ''], periodicVariables: [...previous.periodicVariables, { enabled: false, period: String(DEFAULT_VARIABLE_PERIOD) }] }))} data-testid="system-add-variable">+ Variable</button>
            </header>
            {sections.variables ? (
              <div className="system-editor__card-body">
                {showErrors && validation.errors.varNames ? <div className="field-error">{validation.errors.varNames}</div> : null}
                <ExpressionLanguageReference systemType={draft.type} />
                <div className="system-editor__table-head system-editor__table-head--variables" aria-hidden="true"><span>Name</span><span>{draft.type === 'map' ? 'Next-state expression' : 'Derivative'}</span><span>Domain</span><span /></div>
                <div className="inspector-list system-editor__variable-list">
                  {draft.varNames.map((name, index) => (
                    <div className="system-editor__variable-row" key={`variable-${index}`}>
                      <label className="system-editor__compact-field"><span className="system-editor__mobile-label">Variable</span><input value={name} aria-label={`Variable ${index + 1} name`} onChange={(event) => setDraft((previous) => ({ ...previous, varNames: previous.varNames.map((value, current) => current === index ? event.target.value : value) }))} data-testid={`system-var-${index}`} /></label>
                      <div className="system-editor__equation-field">
                        <span className="system-editor__mobile-label">{draft.type === 'map' ? 'Next-state expression' : 'Derivative'}</span>
                        <div className="system-editor__equation-input"><span>{draft.type === 'map' ? `${name || `x${index + 1}`}ₙ₊₁` : `${name || `x${index + 1}`}′`} =</span><textarea value={draft.equations[index] ?? ''} aria-label={`${name} equation`} onChange={(event) => setDraft((previous) => ({ ...previous, equations: adjustArray(previous.equations, previous.varNames.length, () => '').map((value, current) => current === index ? event.target.value : value) }))} data-testid={`system-eq-${index}`} /></div>
                        {state.equationErrors[index] ? <span className="field-error" data-testid={`system-eq-error-${index}`}>{state.equationErrors[index]}</span> : null}
                      </div>
                      <div className="system-editor__domain-field">
                        <span className="system-editor__mobile-label">Domain</span>
                        <div className="periodic-control">
                          <label className="periodic-control__toggle"><input type="checkbox" checked={Boolean(draft.periodicVariables[index]?.enabled)} onChange={(event) => setDraft((previous) => ({ ...previous, periodicVariables: adjustArray(previous.periodicVariables, previous.varNames.length, () => ({ enabled: false, period: String(DEFAULT_VARIABLE_PERIOD) })).map((value, current) => current === index ? { ...value, enabled: event.target.checked } : value) }))} data-testid={`system-periodic-enabled-${index}`} />Periodic</label>
                          {draft.periodicVariables[index]?.enabled ? <input className="periodic-control__period" value={draft.periodicVariables[index]?.period ?? String(DEFAULT_VARIABLE_PERIOD)} aria-label={`${name} period`} onChange={(event) => setDraft((previous) => ({ ...previous, periodicVariables: adjustArray(previous.periodicVariables, previous.varNames.length, () => ({ enabled: false, period: String(DEFAULT_VARIABLE_PERIOD) })).map((value, current) => current === index ? { ...value, period: event.target.value } : value) }))} data-testid={`system-periodic-period-${index}`} /> : null}
                        </div>
                        {draft.periodicVariables[index]?.enabled && showErrors && validation.errors.periodicVariables?.[index] ? <span className="field-error" data-testid={`system-periodic-error-${index}`}>{validation.errors.periodicVariables[index]}</span> : null}
                      </div>
                      <button type="button" className="system-editor__remove-button" onClick={() => setDraft((previous) => ({ ...previous, varNames: previous.varNames.filter((_, current) => current !== index), equations: previous.equations.filter((_, current) => current !== index), periodicVariables: previous.periodicVariables.filter((_, current) => current !== index) }))} data-testid={`system-remove-var-${index}`}>Remove</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className={`inspector-section system-editor__card system-editor__parameters${sections.parameters ? '' : ' is-collapsed'}`}>
            <header className="system-editor__card-header">
              <button type="button" className="system-editor__section-toggle" aria-expanded={sections.parameters} onClick={() => toggle('parameters')} data-testid="system-toggle-parameters"><span aria-hidden="true">{sections.parameters ? '▾' : '▸'}</span><span className="system-editor__section-copy"><span className="system-editor__eyebrow">Constants</span><span className="system-editor__section-title">Parameters</span></span></button>
              <button type="button" className="system-editor__add-button" onClick={() => setDraft((previous) => ({ ...previous, paramNames: [...previous.paramNames, `p${previous.paramNames.length + 1}`], params: [...previous.params, '0'] }))} data-testid="system-add-parameter">+ Parameter</button>
            </header>
            {sections.parameters ? (
              <div className="system-editor__card-body">
                <div className="system-editor__parameter-tools"><button type="button" className="inspector-inline-button" onClick={() => void copyText(formatValues(draft.params))} disabled={draft.paramNames.length === 0}>Copy values</button><button type="button" className="inspector-inline-button" onClick={() => void pasteParameters()} disabled={draft.paramNames.length === 0}>Paste values</button></div>
                {draft.paramNames.length > 0 ? <div className="inspector-list system-editor__parameter-list">{draft.paramNames.map((name, index) => <div className="system-editor__parameter-row" key={`parameter-${index}`}><label className="system-editor__compact-field"><span className="system-editor__mobile-label">Parameter</span><input value={name} onChange={(event) => setDraft((previous) => ({ ...previous, paramNames: previous.paramNames.map((value, current) => current === index ? event.target.value : value) }))} data-testid={`system-param-${index}`} /></label><label className="system-editor__compact-field"><span className="system-editor__mobile-label">Value</span><input type="text" inputMode="text" placeholder="e.g. tau / 4" value={draft.params[index] ?? ''} onChange={(event) => setDraft((previous) => ({ ...previous, params: adjustArray(previous.params, previous.paramNames.length, () => '0').map((value, current) => current === index ? event.target.value : value) }))} data-testid={`system-param-value-${index}`} /></label><button type="button" className="system-editor__remove-button" onClick={() => setDraft((previous) => ({ ...previous, paramNames: previous.paramNames.filter((_, current) => current !== index), params: previous.params.filter((_, current) => current !== index) }))} data-testid={`system-remove-param-${index}`}>Remove</button></div>)}</div> : <div className="system-editor__empty">No parameters defined. Add one when an equation needs a named constant.</div>}
              </div>
            ) : null}
          </section>
        </div>
      </div>
      <footer className="system-editor__footer">
        <div className="system-editor__status" aria-live="polite">
          {state.message ? <div className="field-error">{state.message}</div> : null}
          {state.validating ? <div className="field-warning">Validating equations…</div> : null}
          {!state.message && !state.validating ? <span>{dirty ? 'Apply changes to use this configuration.' : 'System settings are up to date.'}</span> : null}
        </div>
        <button className="system-editor__apply" onClick={() => void apply()} disabled={state.validating || !dirty} data-testid="system-apply">Apply changes</button>
      </footer>
    </div>
  )
}
