import { useState } from 'react'
import type { ParticleObject, System, TreeNode } from '../../system/types'
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
  const [name, setName] = useState(object.name)
  const node = system.nodes[nodeId]
  const source = system.objects[object.sourceStateGridId]
  const settings = object.settings
  return <div className="inspector-details" data-testid="particle-inspector">
    <section className="inspector-section">
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)}
        onBlur={() => { if (name.trim()) onRename(nodeId, name.trim()) }} /></label>
      <p className="inspector-help">Flow particles · {source?.name ?? object.sourceStateGridName}</p>
      {system.config.type !== 'flow' ? <p className="inspector-error">Particles require a flow system.</p> : null}
      <button type="button" className="inspector-primary-action" data-testid="particles-play"
        onClick={() => onUpdate?.(nodeId, { ...settings, playing: !settings.playing })}>
        {settings.playing ? 'Pause' : 'Play'}</button>
    </section>
    <section className="inspector-section">
      <h3>Animation</h3>
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
    <section className="inspector-section">
      <h3>Appearance</h3>
      <label><input type="checkbox" checked={node.visibility}
        onChange={() => onToggleVisibility?.(nodeId)} /> Visible</label>
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
  </div>
}
