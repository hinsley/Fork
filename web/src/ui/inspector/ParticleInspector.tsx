import { useState } from 'react'
import type { ParticleObject, System, TreeNode } from '../../system/types'
import { InspectorDisclosure, WorkflowActionList, WorkflowFocusToolbar } from './selectionSession'
import { useWorkflowFocus } from './useWorkflowFocus'
import type { WorkflowActionEntry } from './selectionSessionState'
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
      description: 'Set playback speed, lifetime, and particle count.' },
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
  const playback = (
      <button type="button" className="inspector-primary-action" data-testid="particles-play"
        onClick={() => onUpdate?.(nodeId, { ...settings, playing: !settings.playing })}>
        {settings.playing ? 'Pause' : 'Play'}</button>
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
      {playback}
    </section> : null}
    <WorkflowFocusToolbar entries={entries} />
    <WorkflowActionList entries={entries} />
    <InspectorDisclosure title="Animation" testId="particles-animation-toggle"
      actionOnly={actionOnly} defaultOpen={!workflowFocus}>
    <section className="inspector-section">
      {workflowFocus?.activeWorkflow === 'particles-animation-toggle' ? playback : null}
      {([
        ['speed', 'Time scale', 0.01, 10, 0.01],
        ['lifetime', 'Lifetime (simulation seconds)', 0.1, 1000, 0.1],
        ['count', 'Particle count', 1, 2000, 1],
        ['integrationStep', 'Integration step', 0.001, 0.1, 0.001],
      ] as const).map(([key, label, min, max, step]) => <label key={key}>{label}
        <input type="number" min={min} max={max} step={step} value={settings[key]}
          data-testid={`particles-${key}`} onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value) && value >= min && value <= max &&
              (key !== 'count' || Number.isInteger(value))) {
              onUpdate?.(nodeId, { ...settings, [key]: value })
            }
          }} /></label>)}
      <p className="inspector-help">1× advances one simulation second per real second. Particles start with staggered ages and respawn inside the grid after expiring or escaping.</p>
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
      <label>Particle size<input type="range" min={1} max={12} step={0.5}
        value={node.render.pointSize} onChange={(event) =>
          onUpdateRender?.(nodeId, { pointSize: Number(event.target.value) })} /></label>
      <label>Trail length<input type="range" min={0} max={24} step={1}
        value={settings.trailLength} data-testid="particles-trailLength"
        onChange={(event) => onUpdate?.(nodeId, { ...settings, trailLength: Number(event.target.value) })} /></label>
    </section>
    </InspectorDisclosure>
    </div>
  </div>
}
