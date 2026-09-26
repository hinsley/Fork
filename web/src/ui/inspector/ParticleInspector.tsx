import { useState } from 'react'
import type { ParticleObject, System, TreeNode } from '../../system/types'
import { InspectorDisclosure, WorkflowFocusToolbar } from './selectionSession'
import { useWorkflowFocus } from './useWorkflowFocus'
import type { WorkflowActionEntry } from './selectionSessionState'
import { buildSubsystemSnapshot } from '../../system/subsystemGateway'
import { OpacityPercentInput } from '../OpacityPercentInput'
import { ActionBar, EntityHeader, KeyValues, type HeaderPanel } from './InspectorChrome'
import { Icon } from '../Icon'
import { fmtCount } from '../../utils/format'

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
  const appearance = node ? (
    <section className="inspector-section" data-testid="appearance-section">
      <div className="inspector-form-grid">
        <label>Color<input type="color" value={node.render.color}
          onChange={(event) => onUpdateRender?.(nodeId, { color: event.target.value })} /></label>
        <label>Opacity %<OpacityPercentInput ariaLabel="Particle opacity" testId="particles-opacity" value={node.render.opacity}
          onChange={(opacity) => onUpdateRender?.(nodeId, { opacity })} /></label>
      </div>
      {([
        { label: 'Size', id: 'pointSize', value: node.render.pointSize, min: 1, max: 12, step: 0.5,
          update: (value: number) => onUpdateRender?.(nodeId, { pointSize: value }) },
        { label: 'Trail', id: 'trailLength', value: settings.trailLength, min: 0, max: 24, step: 1,
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
  ) : null
  const panels: HeaderPanel[] = appearance ? [{
    id: 'appearance',
    label: 'Appearance',
    icon: (
      <span className="inspector-swatch-icon">
        <Icon name="palette" />
        <span className="inspector-swatch-icon__dot" style={{ background: node?.render.color }}
          aria-hidden="true" />
      </span>
    ),
    content: appearance,
  }] : []
  return <div className={`inspector-panel inspector-browser${workflowFocus?.activeWorkflow ? ' inspector-browser--workflow' : ''}`}
    data-testid="particle-inspector" data-active-workflow={workflowFocus?.activeWorkflow ?? undefined}
    data-navigation-direction={workflowFocus?.navigationDirection ?? undefined}
    data-navigation-phase={workflowFocus?.navigationPhase ?? 'idle'}>
    <div className={`inspector-group inspector-navigation-page${navigationClass}`}
      key={workflowFocus?.activeWorkflow ?? 'particle-root'}>
    <EntityHeader
      name={name}
      onNameChange={setName}
      onNameCommit={() => { if (name.trim()) onRename(nodeId, name.trim()) }}
      onNameCancel={() => setName(object.name)}
      typeLabel="Particles"
      chip={settings.playing
        ? { label: 'playing', tone: 'stable' }
        : { label: 'paused', tone: 'muted' }}
      detail={[continuous ? 'Continuous' : 'Bounded respawn']}
      visible={node?.visibility ?? true}
      onToggleVisibility={onToggleVisibility ? () => onToggleVisibility(nodeId) : undefined}
      panels={panels}
    />
    <div className="inspector-glance">
      {system.config.type !== 'flow' ? <p className="inspector-error">Particles require a flow system.</p> : null}
      <KeyValues rows={[
        { label: 'Source', value: source?.name ?? object.sourceStateGridName },
        seedCount !== null
          ? { label: 'Seeds', value: <span data-testid="particles-seed-summary">{fmtCount(seedCount)}</span> }
          : null,
      ]} />
      <div className="action-bar">
        <button type="button" className="btn btn--primary" data-testid="particles-play"
          onClick={() => onUpdate?.(nodeId, { ...settings, playing: !settings.playing })}>
          <Icon name={settings.playing ? 'pause' : 'play'} size={13} />
          {settings.playing ? 'Pause' : 'Play'}</button>
        <button type="button" className="btn" data-testid="particles-reset"
          onClick={() => onUpdate?.(nodeId, { ...settings, resetRevision: (settings.resetRevision ?? 0) + 1 })}>
          Reset to grid</button>
      </div>
    </div>
    <WorkflowFocusToolbar entries={entries} />
    <ActionBar entries={entries} />
    <InspectorDisclosure title="Animation" testId="particles-animation-toggle"
      actionOnly={actionOnly} defaultOpen={!workflowFocus}>
    <section className="inspector-section"
      title={continuous
        ? 'Every grid point evolves continuously, without lifetime expiry or boundary resets.'
        : 'Every grid point seeds a particle; lifetimes and boundary exits reset it to its grid point.'}>
      <label>Mode<select value={settings.mode ?? 'bounded'} data-testid="particles-mode"
        onChange={(event) => onUpdate?.(nodeId, { ...settings, mode: event.target.value as 'bounded' | 'continuous' })}>
        <option value="bounded">Bounded respawn</option>
        <option value="continuous">Continuous</option>
      </select></label>
      {([
        ['speed', 'Time scale', 0.01, 10, 0.01, '1× advances one simulation second per real second'],
        ...(!continuous ? [['lifetime', 'Lifetime', 0.1, 1000, 0.1, 'Lifetime in simulation seconds'] as const] : []),
        ['integrationStep', 'dt', 0.001, 0.1, 0.001, 'Integration step'],
      ] as const).map(([key, label, min, max, step, hint]) => <label key={key} title={hint}>{label}
        <input type="number" min={min} max={max} step={step} value={settings[key]}
          data-testid={`particles-${key}`} onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value) && value >= min && value <= max) {
              onUpdate?.(nodeId, { ...settings, [key]: value })
            }
          }} /></label>)}
    </section>
    </InspectorDisclosure>
    </div>
  </div>
}
