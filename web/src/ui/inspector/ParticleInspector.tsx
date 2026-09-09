import { useState } from 'react'
import type { ParticleObject, System, TreeNode } from '../../system/types'
import { InspectorDisclosure, WorkflowActionList, WorkflowFocusToolbar } from './selectionSession'
import { useWorkflowFocus } from './useWorkflowFocus'
import type { WorkflowActionEntry } from './selectionSessionState'
import { buildSubsystemSnapshot } from '../../system/subsystemGateway'
import { OpacityPercentInput } from '../OpacityPercentInput'

type Props = {
  system: System
  nodeId: string
  object: ParticleObject
  onUpdate?: (id: string, settings: ParticleObject['settings']) => void
  onRename: (id: string, name: string) => void
  onUpdateRender?: (id: string, render: Partial<TreeNode['render']>) => void
  onToggleVisibility?: (id: string) => void
}

export function ParticleInspector({ system, nodeId, object, onUpdate, onRename,
  onUpdateRender, onToggleVisibility }: Props) {
  const workflowFocus = useWorkflowFocus()
  const actionOnly = Boolean(workflowFocus)
  const entries: WorkflowActionEntry[] = [
    { id: 'particles-animation-toggle', group: 'Configure', label: 'Animation',
      description: 'Choose evolution mode, playback speed, and lifetime.' },
    { id: 'appearance-toggle', group: 'Configure', label: 'Appearance',
      description: 'Change visibility, color, opacity, size, and trails.' },
  ]
  const navigationClass =
    workflowFocus?.navigationPhase !== 'idle' && workflowFocus?.navigationDirection
      ? ` inspector-navigation-page--${workflowFocus.navigationPhase}-${workflowFocus.navigationDirection}`
      : ''
  const [name, setName] = useState(object.name)
  const node = system.nodes[nodeId]
  const source = system.objects[object.sourceStateGridId]
  const settings = object.settings
  const continuous = settings.mode === 'continuous'
  const seedCount = source?.type === 'state_grid'
    ? buildSubsystemSnapshot(system.config, source.frozenVariables).freeVariableNames.reduce((count, name) =>
      count * (source.axes.find((axis) => axis.variableName === name)?.resolution ?? 0), 1)
    : null
  const playback = (
    <div className="inspector-inline-actions">
      <button type="button" className="inspector-primary-action" data-testid="particles-play"
        onClick={() => onUpdate?.(nodeId, { ...settings, playing: !settings.playing })}>
        {settings.playing ? 'Pause' : 'Play'}</button>
      <button type="button" data-testid="particles-reset"
        onClick={() => onUpdate?.(nodeId, { ...settings, resetRevision: (settings.resetRevision ?? 0) + 1 })}>
        Reset to grid</button>
    </div>
  )
  return <div className={`inspector-panel inspector-browser${workflowFocus?.activeWorkflow ? ' inspector-browser--workflow' : ''}`}
    data-testid="particle-inspector" data-active-workflow={workflowFocus?.activeWorkflow ?? undefined}
    data-navigation-direction={workflowFocus?.navigationDirection ?? undefined}
    data-navigation-phase={workflowFocus?.navigationPhase ?? 'idle'}>
    <div className={`inspector-group inspector-navigation-page${navigationClass}`}
      key={workflowFocus?.activeWorkflow ?? 'particle-root'}>
    {!workflowFocus?.activeWorkflow ? <section className="inspector-section inspector-entity-header">
      <div className="inspector-meta"><span>Particles</span><span>Flow</span></div>
      <label><span className="inspector-entity-header__name-label">Name</span><input data-testid="inspector-name" value={name} onChange={(event) => setName(event.target.value)}
        onBlur={() => { if (name.trim()) onRename(nodeId, name.trim()) }} /></label>
      <p className="inspector-help">Source grid · {source?.name ?? object.sourceStateGridName}</p>
      {system.config.type !== 'flow' ? <p className="inspector-error">Particles require a flow system.</p> : null}
      {seedCount !== null ? <p className="inspector-help" data-testid="particles-seed-summary">
        {seedCount.toLocaleString()} grid points · {continuous ? 'Continuous' : 'Bounded respawn'}</p> : null}
      {playback}
    </section> : null}
    <WorkflowFocusToolbar entries={entries} />
    <WorkflowActionList entries={entries} />
    <InspectorDisclosure title="Animation" testId="particles-animation-toggle"
      actionOnly={actionOnly} defaultOpen={!workflowFocus}>
    <section className="inspector-section">
      {workflowFocus?.activeWorkflow === 'particles-animation-toggle' ? playback : null}
      <label>Mode<select value={settings.mode ?? 'bounded'} data-testid="particles-mode"
        onChange={(event) => onUpdate?.(nodeId, { ...settings, mode: event.target.value as 'bounded' | 'continuous' })}>
        <option value="bounded">Bounded respawn</option>
        <option value="continuous">Continuous (no respawn)</option>
      </select></label>
      {([
        ['speed', 'Time scale', 0.01, 10, 0.01],
        ...(!continuous ? [['lifetime', 'Lifetime (simulation seconds)', 0.1, 1000, 0.1] as const] : []),
        ['integrationStep', 'Integration step', 0.001, 0.1, 0.001],
      ] as const).map(([key, label, min, max, step]) => <label key={key}>{label}
        <input type="number" min={min} max={max} step={step} value={settings[key]}
          data-testid={`particles-${key}`} onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value) && value >= min && value <= max) {
              onUpdate?.(nodeId, { ...settings, [key]: value })
            }
          }} /></label>)}
      <p className="inspector-help">1× advances one simulation second per real second.
        {continuous ? ' Every grid point evolves continuously, without lifetime expiry or boundary resets. The view expands as trajectories spread.'
          : ' Every grid point seeds a particle. Staggered lifetimes and boundary exits reset each particle to its original grid point.'}</p>
    </section>
    </InspectorDisclosure>
    <InspectorDisclosure title="Appearance" testId="appearance-toggle"
      actionOnly={actionOnly} defaultOpen={!workflowFocus}>
    <section className="inspector-section">
      <label>Visibility<button type="button" data-testid="inspector-visibility"
        onClick={() => onToggleVisibility?.(nodeId)}>{node.visibility ? 'Visible' : 'Hidden'}</button></label>
      <label>Color<input type="color" value={node.render.color}
        onChange={(event) => onUpdateRender?.(nodeId, { color: event.target.value })} /></label>
      <label>Opacity<OpacityPercentInput ariaLabel="Particle opacity" testId="particles-opacity" value={node.render.opacity}
        onChange={(opacity) => onUpdateRender?.(nodeId, { opacity })} /></label>
      {([
        { label: 'Particle size', id: 'pointSize', value: node.render.pointSize, min: 1, max: 12, step: 0.5,
          update: (value: number) => onUpdateRender?.(nodeId, { pointSize: value }) },
        { label: 'Trail length', id: 'trailLength', value: settings.trailLength, min: 0, max: 24, step: 1,
          update: (value: number) => onUpdate?.(nodeId, { ...settings, trailLength: value }) },
      ]).map((control) => <label key={control.id}>{control.label}
        <span className="particle-appearance-control">
          <input type="range" min={control.min} max={control.max} step={control.step}
            aria-label={`${control.label} slider`} value={control.value}
            data-testid={`particles-${control.id}`}
            onChange={(event) => control.update(Number(event.target.value))} />
          <input type="number" min={control.min} max={control.max} step={control.step}
            aria-label={control.label} value={control.value}
            data-testid={`particles-${control.id}-number`}
            onChange={(event) => {
              if (event.target.value.trim() === '') return
              const value = Number(event.target.value)
              if (Number.isFinite(value) && value >= control.min && value <= control.max &&
                (control.id !== 'trailLength' || Number.isInteger(value))) control.update(value)
            }} />
        </span>
      </label>)}
    </section>
    </InspectorDisclosure>
    </div>
  </div>
}
