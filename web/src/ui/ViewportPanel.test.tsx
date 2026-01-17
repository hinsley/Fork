import { render } from '@testing-library/react'
import type { Layout } from 'plotly.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewportPanel } from './ViewportPanel'
import {
  addBifurcationDiagram,
  addScene,
  createSystem,
  updateBifurcationDiagram,
  updateScene,
} from '../system/model'
import type { Scene, SystemConfig } from '../system/types'

type PlotlyProps = {
  plotId: string
  layout: Partial<Layout>
  viewRevision: number | string
  initialView: Record<string, unknown> | null
}

const plotlyCalls: PlotlyProps[] = []

vi.mock('../viewports/plotly/PlotlyViewport', () => ({
  PlotlyViewport: (props: PlotlyProps) => {
    plotlyCalls.push(props)
    return <div data-testid={`plotly-${props.plotId}`} />
  },
}))

function renderPanel(system: ReturnType<typeof createSystem>) {
  render(
    <ViewportPanel
      system={system}
      selectedNodeId={null}
      theme="light"
      onSelectViewport={vi.fn()}
      onSelectObject={vi.fn()}
      onReorderViewport={vi.fn()}
      onResizeViewport={vi.fn()}
      onToggleViewport={vi.fn()}
      onCreateScene={vi.fn()}
      onCreateBifurcation={vi.fn()}
      onRenameViewport={vi.fn()}
      onDeleteViewport={vi.fn()}
    />
  )
}

describe('ViewportPanel view state wiring', () => {
  beforeEach(() => {
    plotlyCalls.length = 0
  })

  it('omits axis ranges from 2D layouts but seeds initialView', () => {
    let system = createSystem({ name: '2D System' })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisRanges: { x: [-2, 2], y: [1, 3] },
      camera: {
        eye: { x: 2, y: 3, z: 4 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 },
      },
      viewRevision: 5,
    })

    renderPanel(system)

    const props = plotlyCalls.find((entry) => entry.plotId === sceneResult.nodeId)
    expect(props).toBeTruthy()
    expect(props?.layout?.scene).toBeUndefined()
    expect(props?.layout?.xaxis?.range).toBeUndefined()
    expect(props?.layout?.yaxis?.range).toBeUndefined()
    expect(props?.viewRevision).toBe(5)
    expect(props?.initialView).toMatchObject({
      'xaxis.range': [-2, 2],
      'yaxis.range': [1, 3],
    })
  })

  it('marks autorange when a stored axis range is null', () => {
    let system = createSystem({ name: 'Auto System' })
    const sceneResult = addScene(system, 'Scene Auto')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisRanges: { x: null, y: [0, 2] },
      viewRevision: 1,
    })

    renderPanel(system)

    const props = plotlyCalls.find((entry) => entry.plotId === sceneResult.nodeId)
    expect(props).toBeTruthy()
    expect(props?.initialView).toMatchObject({
      'xaxis.autorange': true,
      'yaxis.range': [0, 2],
    })
  })

  it('omits camera from 3D layouts but seeds initialView', () => {
    const config: SystemConfig = {
      name: '3D System',
      equations: ['x', 'y', 'z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    let system = createSystem({ name: '3D System', config })
    const sceneResult = addScene(system, 'Scene 3D')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      camera: {
        eye: { x: 4, y: 5, z: 6 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 },
      },
      viewRevision: 2,
    })

    renderPanel(system)

    const props = plotlyCalls.find((entry) => entry.plotId === sceneResult.nodeId)
    expect(props).toBeTruthy()
    expect(props?.layout?.scene?.camera).toBeUndefined()
    expect(props?.viewRevision).toBe(2)
    expect(props?.initialView).toMatchObject({
      'scene.camera': {
        eye: { x: 4, y: 5, z: 6 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 },
      },
    })
  })

  it('does not throw when a 3D scene is missing a camera', () => {
    const config: SystemConfig = {
      name: '3D System',
      equations: ['x', 'y', 'z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    let system = createSystem({ name: '3D Missing Camera', config })
    const sceneResult = addScene(system, 'Scene 3D')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      camera: undefined as unknown as Scene['camera'],
      viewRevision: 1,
    })

    expect(() => renderPanel(system)).not.toThrow()

    const props = plotlyCalls.find((entry) => entry.plotId === sceneResult.nodeId)
    expect(props).toBeTruthy()
    expect(props?.initialView).toBeNull()
  })

  it('omits diagram ranges from layout but seeds initialView', () => {
    let system = createSystem({ name: 'Diagram System' })
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(diagramResult.system, diagramResult.nodeId, {
      axisRanges: { x: [-3, 3], y: [2, 4] },
      viewRevision: 7,
    })

    renderPanel(system)

    const props = plotlyCalls.find((entry) => entry.plotId === diagramResult.nodeId)
    expect(props).toBeTruthy()
    expect(props?.layout?.xaxis?.range).toBeUndefined()
    expect(props?.layout?.yaxis?.range).toBeUndefined()
    expect(props?.viewRevision).toBe(7)
    expect(props?.initialView).toMatchObject({
      'xaxis.range': [-3, 3],
      'yaxis.range': [2, 4],
    })
  })
})
