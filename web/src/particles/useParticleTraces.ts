import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from 'plotly.js'
import type { ParticleObject, ParticleSettings, Scene, System } from '../system/types'
import { isNodeEffectivelyVisible } from '../system/model'
import { buildReducedRunConfig, buildSubsystemSnapshot } from '../system/subsystemGateway'
import { resolveObjectParams } from '../system/parameters'
import { resolveSceneProjection } from '../system/sceneProjection'
import type { Particle } from './particleSimulation'
import type { ParticleWorkerInput } from './particleWorker'

type Frame = { id: string; particles: Particle[]; time: number }

export function useParticleTraces(system: System, scene: Scene | undefined,
  candidateIds: string[], enabled: boolean) {
  const objects = candidateIds.flatMap((id) => {
    const object = system.objects[id]
    return enabled && system.config.type === 'flow' && object?.type === 'particles' &&
      isNodeEffectivelyVisible(system.nodes, id) ? [{ ...object, id }] : []
  })
  const settingsRef = useRef<Record<string, ParticleSettings>>({})
  useEffect(() => {
    settingsRef.current = Object.fromEntries(objects.map((object) => [object.id, object.settings]))
  })
  const descriptors = objects.map((object) => ({ id: object.id, grid: system.objects[object.sourceStateGridId] }))
  const inputKey = JSON.stringify({ config: system.config, descriptors })
  const [result, setResult] = useState<{ key: string; frames: Frame[]; error?: string }>({ key: '', frames: [] })
  useEffect(() => {
    const parsed = JSON.parse(inputKey) as {
      config: System['config']; descriptors: Array<{ id: string; grid: System['objects'][string] }>
    }
    if (!parsed.descriptors.length || typeof Worker === 'undefined') return
    let worker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    try {
      const inputs: ParticleWorkerInput[] = parsed.descriptors.map(({ id, grid }) => {
        if (grid?.type !== 'state_grid') throw new Error('The source State Grid is unavailable.')
        const snapshot = buildSubsystemSnapshot(parsed.config, grid.frozenVariables)
        const config = buildReducedRunConfig(parsed.config, snapshot,
          resolveObjectParams(parsed.config, grid.customParameters))
        const axes = config.varNames.map((name) => {
          const axis = grid.axes.find((axis) => axis.variableName === name)
          if (!axis) throw new Error(`The source grid needs bounds for ${name}.`)
          return axis
        })
        return { id, config, axes, settings: settingsRef.current[id] }
      })
      worker = new Worker(new URL('./particleWorker.ts', import.meta.url), { type: 'module' })
      let last = performance.now()
      let lastSettings = JSON.stringify(settingsRef.current)
      const requestFrame = () => {
        if (disposed) return
        const now = performance.now()
        const seconds = (now - last) / 1000
        last = now
        const settingsKey = JSON.stringify(settingsRef.current)
        if (document.hidden || (settingsKey === lastSettings &&
          !Object.values(settingsRef.current).some((settings) => settings.playing))) {
          timer = setTimeout(requestFrame, 100)
          return
        }
        lastSettings = settingsKey
        worker?.postMessage({ type: 'frame', seconds, settings: settingsRef.current })
      }
      worker.onmessage = (event: MessageEvent<{ frames?: Frame[]; error?: string }>) => {
        if (disposed) return
        setResult({ key: inputKey, frames: event.data.frames ?? [], error: event.data.error })
        if (!event.data.error) timer = setTimeout(requestFrame, 33)
      }
      worker.onerror = (event) => setResult({ key: inputKey, frames: [], error: event.message || 'Particle worker failed.' })
      worker.postMessage({ type: 'init', inputs })
    } catch (error) {
      queueMicrotask(() => {
        if (!disposed) setResult({ key: inputKey, frames: [], error: error instanceof Error ? error.message : String(error) })
      })
    }
    return () => { disposed = true; clearTimeout(timer); worker?.terminate() }
  }, [inputKey])
  const appearanceKey = JSON.stringify(objects.map((object) => ({ object, render: system.nodes[object.id].render })))
  const projectionKey = JSON.stringify(scene ? resolveSceneProjection(system.config, scene.axisVariables) : null)
  const traces = useMemo(() => {
    if (result.key !== inputKey) return []
    const projection = JSON.parse(projectionKey) as ReturnType<typeof resolveSceneProjection>
    if (!projection) return []
    const appearance = JSON.parse(appearanceKey) as Array<{ object: ParticleObject & { id: string }; render: System['nodes'][string]['render'] }>
    const parsed = JSON.parse(inputKey) as { config: System['config']; descriptors: Array<{ id: string; grid: System['objects'][string] }> }
    return result.frames.flatMap((frame): Data[] => {
      const entry = appearance.find((entry) => entry.object.id === frame.id)
      const grid = parsed.descriptors.find((entry) => entry.id === frame.id)?.grid
      if (!entry || grid?.type !== 'state_grid') return []
      const { object, render } = entry
      const free = buildSubsystemSnapshot(parsed.config, grid.frozenVariables).freeVariableNames
      const coordinate = (state: number[], axis: number) => {
        const name = parsed.config.varNames[projection.axisIndices[axis]]
        const index = free.indexOf(name)
        return index < 0 ? grid.frozenVariables?.frozenValuesByVarName[name] ?? 0 : state[index]
      }
      const color = (alpha: number) => {
        const hex = render.color.replace('#', '')
        const value = Number.parseInt(hex, 16)
        return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`
      }
      const points: number[][] = []
      const times: number[] = []
      const colors: string[] = []
      const sizes: number[] = []
      for (const particle of frame.particles) {
        const fade = object.settings.mode === 'continuous' ? 1 : Math.min(1, particle.age / (object.settings.lifetime * 0.08),
          Math.max(0, (object.settings.lifetime - particle.age) / (object.settings.lifetime * 0.2)))
        particle.trail.slice(0, object.settings.trailLength).reverse().forEach((point, index, trail) => {
          points.push(point)
          times.push(particle.trailTimes[trail.length - 1 - index])
          colors.push(color(render.opacity * fade * 0.45 * (index + 1) / trail.length))
          sizes.push(render.pointSize * (0.3 + 0.5 * (index + 1) / trail.length))
        })
        points.push(particle.state)
        times.push(frame.time)
        colors.push(color(render.opacity * fade))
        sizes.push(render.pointSize)
      }
      const oneDimensional = projection.axisCount === 1
      return [{ uid: object.id, name: object.name,
        type: projection.axisCount === 3 ? 'scatter3d' : 'scattergl', mode: 'markers',
        x: points.map((point, index) => oneDimensional ? times[index] : coordinate(point, 0)),
        y: points.map((point) => coordinate(point, oneDimensional ? 0 : 1)),
        ...(projection.axisCount === 3 ? { z: points.map((point) => coordinate(point, 2)) } : {}),
        marker: { color: colors, size: sizes, line: { width: 0 } },
        hoverinfo: 'skip', showlegend: false,
        meta: { particleMode: object.settings.mode ?? 'bounded', particleSeeds: frame.particles.length },
      } as Data]
    })
  }, [appearanceKey, inputKey, projectionKey, result])
  const stoppedCount = result.key === inputKey
    ? result.frames.reduce((count, frame) => count + frame.particles.filter((particle) => particle.stopped).length, 0) : 0
  return { traces, error: result.key === inputKey ? result.error : undefined,
    warning: stoppedCount ? `${stoppedCount} trajectories stopped at their last finite position because integration became nonfinite.` : undefined }
}
