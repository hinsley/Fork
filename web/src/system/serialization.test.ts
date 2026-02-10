import { describe, expect, it } from 'vitest'
import {
  addObject,
  addScene,
  createSystem,
  updateLayout,
  updateNodeRender,
  updateViewportHeights,
} from './model'
import {
  deserializeSystem,
  deserializeSystemData,
  mergeSystem,
  SYSTEM_DATA_SCHEMA_VERSION,
  SYSTEM_PROJECT_SCHEMA_VERSION,
  serializeSystem,
  serializeSystemData,
  serializeSystemUi,
} from './serialization'
import type { OrbitObject } from './types'

describe('system serialization', () => {
  it('round-trips UI state in the project bundle', () => {
    const base = createSystem({ name: 'Demo' })
    const { system: withScene, nodeId: sceneId } = addScene(base, 'Scene 1')
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit A',
      systemName: withScene.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
    }
    const { system: withObject, nodeId } = addObject(withScene, orbit)
    const withLayout = updateLayout(withObject, { leftWidth: 360 })
    const viewportId = sceneId
    const withHeights = updateViewportHeights(withLayout, { [viewportId]: 320 })
    const withRender = updateNodeRender(withHeights, nodeId, {
      color: '#ff0000',
      lineWidth: 5,
    })

    const bundle = serializeSystem(withRender)
    const restored = deserializeSystem(bundle)

    expect(restored.ui.layout.leftWidth).toBe(360)
    expect(restored.ui.viewportHeights[viewportId]).toBe(320)
    expect(restored.nodes[nodeId].render.color).toBe('#ff0000')
    expect(restored.nodes[nodeId].render.lineWidth).toBe(5)
    expect(restored.objects[nodeId].name).toBe('Orbit A')
  })

  it('merges UI and data bundles back into a system', () => {
    const base = createSystem({ name: 'Split' })
    const { system: withScene, nodeId: sceneId } = addScene(base, 'Scene 1')
    const withLayout = updateLayout(withScene, { rightWidth: 400 })
    const viewportId = sceneId
    const withHeights = updateViewportHeights(withLayout, { [viewportId]: 280 })

    const dataBundle = serializeSystemData(withHeights)
    const uiBundle = serializeSystemUi(withHeights)
    const merged = mergeSystem(dataBundle.system, uiBundle.ui)

    expect(merged.ui.layout.rightWidth).toBe(400)
    expect(merged.ui.viewportHeights[viewportId]).toBe(280)
    expect(merged.config.name).toBe('Split')
  })

  it('extracts UI from legacy bundles', () => {
    const system = createSystem({ name: 'Legacy' })
    const legacy = { schemaVersion: SYSTEM_DATA_SCHEMA_VERSION, system }
    const { data, ui } = deserializeSystemData(legacy)

    expect(data.id).toBe(system.id)
    expect(ui?.rootIds.length).toBe(0)
    expect(ui?.ui.layout.leftWidth).toBe(system.ui.layout.leftWidth)
  })

  it('rejects old schema bundles with recompute guidance', () => {
    const system = createSystem({ name: 'OldSchema' })
    expect(() =>
      deserializeSystem({
        schemaVersion: SYSTEM_PROJECT_SCHEMA_VERSION - 1,
        system,
      })
    ).toThrow(/Recompute analyses with the current app version/i)
  })
})
