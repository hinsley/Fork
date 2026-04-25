import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import type { Data, Layout } from 'plotly.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewportPanel } from './ViewportPanel'
import type { ComputeIsoclineResult } from '../compute/ForkCoreClient'
import {
  addObject,
  addAnalysisViewport,
  addBranch,
  addBifurcationDiagram,
  addScene,
  updateNodeRender,
  createSystem,
  updateLimitCycleRenderTarget,
  updateAnalysisViewport,
  updateBifurcationDiagram,
  updateScene
} from '../system/model'
import type {
  ContinuationObject,
  ContinuationSettings,
  EquilibriumObject,
  IsoclineObject,
  LimitCycleObject,
  OrbitObject,
  Scene,
  SystemConfig
} from '../system/types'
import type {
  BranchPointSelection,
  LimitCyclePointSelection,
  OrbitPointSelection
} from './branchPointSelection'
import { nowIso } from '../utils/determinism'
import { buildSubsystemSnapshot } from '../system/subsystemGateway'

type PlotlyProps = {
  plotId: string
  data: Data[]
  layout: Partial<Layout>
  viewRevision: number | string
  initialView: Record<string, unknown> | null
  onPointClick?: (point: {
    uid?: string
    pointIndex?: number
    customdata?: unknown
    x?: number
    y?: number
    z?: number
  }) => void
}

const plotlyCalls: PlotlyProps[] = []

vi.mock('../viewports/plotly/PlotlyViewport', () => ({
  PlotlyViewport: (props: PlotlyProps) => {
    plotlyCalls.push(props)
    return <div data-testid={`plotly-${props.plotId}`} />
  }
}))

type RenderPanelOverrides = {
  branchPointSelection?: BranchPointSelection
  orbitPointSelection?: OrbitPointSelection
  limitCyclePointSelection?: LimitCyclePointSelection
  selectedNodeId?: string | null
  isoclineGeometryCache?: Record<
    string,
    {
      signature: string
      geometry: ComputeIsoclineResult
    }
  >
}

function renderPanel(
  system: ReturnType<typeof createSystem>,
  overrides: RenderPanelOverrides = {}
) {
  render(
    <ViewportPanel
      system={system}
      selectedNodeId={overrides.selectedNodeId ?? null}
      branchPointSelection={overrides.branchPointSelection}
      orbitPointSelection={overrides.orbitPointSelection}
      limitCyclePointSelection={overrides.limitCyclePointSelection}
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
      isoclineGeometryCache={overrides.isoclineGeometryCache}
    />
  )
}

function buildIsoclineSignature(object: IsoclineObject): string {
  const snapshot = object.lastComputed
  if (!snapshot) return ''
  return JSON.stringify({
    source: snapshot.source,
    expression: snapshot.expression,
    level: snapshot.level,
    axes: snapshot.axes,
    frozenState: snapshot.frozenState,
    parameters: snapshot.parameters
  })
}

describe('ViewportPanel view state wiring', () => {
  beforeEach(() => {
    plotlyCalls.length = 0
  })

  it('opens a viewport context menu and duplicates a viewport', async () => {
    const user = userEvent.setup()
    let system = createSystem({ name: 'Viewport_Duplicate_System' })
    const sceneResult = addScene(system, 'Scene_1')
    system = sceneResult.system
    const onDuplicateViewport = vi.fn()

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
        onDuplicateViewport={onDuplicateViewport}
        onDeleteViewport={vi.fn()}
      />
    )

    fireEvent.contextMenu(
      screen.getByTestId(`viewport-header-${sceneResult.nodeId}`)
    )
    await user.click(screen.getByTestId('viewport-context-duplicate'))

    expect(onDuplicateViewport).toHaveBeenCalledWith(sceneResult.nodeId)
  })

  it('falls back to event point index when selecting orbit points from scene traces', () => {
    let system = createSystem({ name: 'Orbit_Click_System' })
    const sceneResult = addScene(system, 'Scene 1')
    system = sceneResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Click_Target',
      systemName: system.config.name,
      data: [
        [0, 0.1, 0.2],
        [0.1, 0.3, 0.4],
        [0.2, 0.5, 0.6]
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system
    const onSelectObject = vi.fn()
    const onSelectOrbitPoint = vi.fn()

    render(
      <ViewportPanel
        system={system}
        selectedNodeId={null}
        theme="light"
        onSelectViewport={vi.fn()}
        onSelectObject={onSelectObject}
        onSelectOrbitPoint={onSelectOrbitPoint}
        onReorderViewport={vi.fn()}
        onResizeViewport={vi.fn()}
        onToggleViewport={vi.fn()}
        onCreateScene={vi.fn()}
        onCreateBifurcation={vi.fn()}
        onRenameViewport={vi.fn()}
        onDeleteViewport={vi.fn()}
      />
    )

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props?.onPointClick).toBeDefined()

    props?.onPointClick?.({
      uid: orbitResult.nodeId,
      pointIndex: 2
    })

    expect(onSelectObject).toHaveBeenCalledWith(orbitResult.nodeId)
    expect(onSelectOrbitPoint).toHaveBeenCalledWith({
      orbitId: orbitResult.nodeId,
      pointIndex: 2
    })
  })

  it('renders a selected orbit-point marker in state-space scenes', () => {
    const config: SystemConfig = {
      name: 'Orbit_Selected_Point_System',
      equations: ['x', 'y', 'z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: 'Orbit_Selected_Point_System', config })
    const sceneResult = addScene(system, 'Scene 1')
    system = sceneResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Selected_Point',
      systemName: system.config.name,
      data: [
        [0, 1, 2, 3],
        [0.1, 4, 5, 6],
        [0.2, 7, 8, 9]
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system

    renderPanel(system, {
      selectedNodeId: orbitResult.nodeId,
      orbitPointSelection: { orbitId: orbitResult.nodeId, pointIndex: 1 }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const selectedTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === `${orbit.name} selected point` &&
        'mode' in trace &&
        trace.mode === 'markers'
    ) as
      | {
          type?: string
          x?: number[]
          y?: number[]
          z?: number[]
          customdata?: number[]
          marker?: { symbol?: string }
          showlegend?: boolean
        }
      | undefined

    expect(selectedTrace?.type).toBe('scatter3d')
    expect(selectedTrace?.x).toEqual([4])
    expect(selectedTrace?.y).toEqual([5])
    expect(selectedTrace?.z).toEqual([6])
    expect(selectedTrace?.customdata).toEqual([1])
    expect(selectedTrace?.marker?.symbol).toBe('circle-open')
    expect(selectedTrace?.showlegend).toBe(false)

    const orbitTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === orbit.name &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { hovertemplate?: string; text?: string[] } | undefined
    expect(orbitTrace?.hovertemplate).toBe(
      'x: %{x:.6g}<br>y: %{y:.6g}<br>z: %{z:.6g}<br>t: %{text}<extra></extra>'
    )
    expect(orbitTrace?.text).toEqual(['0.000', '0.100', '0.200'])
  })

  it('renders selected orbit hit markers from exact event-hit state', () => {
    const config: SystemConfig = {
      name: 'Orbit_Selected_Hit_System',
      equations: ['x', 'y', 'z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: 'Orbit_Selected_Hit_System', config })
    const sceneResult = addScene(system, 'Scene 1')
    system = sceneResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Selected_Hit',
      systemName: system.config.name,
      data: [
        [0, 1, 2, 3],
        [0.1, 4, 5, 6],
        [0.2, 7, 8, 9]
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system

    renderPanel(system, {
      selectedNodeId: orbitResult.nodeId,
      orbitPointSelection: {
        orbitId: orbitResult.nodeId,
        pointIndex: 1,
        hitIndex: 3,
        time: 0.125,
        state: [10, 11, 12]
      }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    const selectedTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === `${orbit.name} selected point` &&
        'mode' in trace &&
        trace.mode === 'markers'
    ) as
      | {
          x?: number[]
          y?: number[]
          z?: number[]
          text?: string[]
        }
      | undefined

    expect(selectedTrace?.x).toEqual([10])
    expect(selectedTrace?.y).toEqual([11])
    expect(selectedTrace?.z).toEqual([12])
    expect(selectedTrace?.text).toEqual(['Selected hit: 3'])
  })

  it('does not render selected orbit-point markers when no orbit object is selected (flow)', () => {
    const config: SystemConfig = {
      name: 'Orbit_Selected_Point_Flow_No_Selected_Orbit',
      equations: ['x', 'y', 'z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = sceneResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Selected_Point',
      systemName: system.config.name,
      data: [
        [0, 1, 2, 3],
        [0.1, 4, 5, 6],
        [0.2, 7, 8, 9]
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system

    renderPanel(system, {
      selectedNodeId: null,
      orbitPointSelection: { orbitId: orbitResult.nodeId, pointIndex: 1 }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const selectedTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === `${orbit.name} selected point` &&
        'mode' in trace &&
        trace.mode === 'markers'
    )
    expect(selectedTrace).toBeFalsy()
  })

  it('does not render selected orbit-point markers when no orbit object is selected (map)', () => {
    const config: SystemConfig = {
      name: 'Orbit_Selected_Point_Map_No_Selected_Orbit',
      equations: ['r * x * (1 - x)'],
      params: [2.5],
      paramNames: ['r'],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = sceneResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Map_Selected_Point',
      systemName: system.config.name,
      data: [
        [0, 0.2],
        [1, 0.4],
        [2, 0.6]
      ],
      t_start: 0,
      t_end: 2,
      dt: 1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system

    renderPanel(system, {
      selectedNodeId: null,
      orbitPointSelection: { orbitId: orbitResult.nodeId, pointIndex: 1 }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const selectedTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === `${orbit.name} selected point` &&
        'mode' in trace &&
        trace.mode === 'markers'
    )
    expect(selectedTrace).toBeFalsy()
  })

  it('selects limit cycle points from scene clicks using trace customdata', () => {
    const config: SystemConfig = {
      name: 'LC_Click_System',
      equations: ['y', '-x'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: 'LC_Click_System', config })
    const sceneResult = addScene(system, 'Scene 1')
    system = sceneResult.system
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Click_Target',
      systemName: config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_A' },
      ntst: 2,
      ncol: 1,
      period: 2,
      state: [1, 0, 0, 1, -1, 0, 2],
      createdAt: nowIso()
    }
    const limitCycleResult = addObject(system, limitCycle)
    system = limitCycleResult.system
    const onSelectObject = vi.fn()
    const onSelectLimitCyclePoint = vi.fn()

    render(
      <ViewportPanel
        system={system}
        selectedNodeId={null}
        theme="light"
        onSelectViewport={vi.fn()}
        onSelectObject={onSelectObject}
        onSelectLimitCyclePoint={onSelectLimitCyclePoint}
        onReorderViewport={vi.fn()}
        onResizeViewport={vi.fn()}
        onToggleViewport={vi.fn()}
        onCreateScene={vi.fn()}
        onCreateBifurcation={vi.fn()}
        onRenameViewport={vi.fn()}
        onDeleteViewport={vi.fn()}
      />
    )

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props?.onPointClick).toBeDefined()

    props?.onPointClick?.({
      uid: limitCycleResult.nodeId,
      customdata: 1
    })

    expect(onSelectObject).toHaveBeenCalledWith(limitCycleResult.nodeId)
    expect(onSelectLimitCyclePoint).toHaveBeenCalledWith({
      limitCycleId: limitCycleResult.nodeId,
      pointIndex: 1
    })
  })

  it('renders selected limit-cycle markers and hover text without time', () => {
    const config: SystemConfig = {
      name: 'LC_Selected_Point_System',
      equations: ['y', '-x'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: 'LC_Selected_Point_System', config })
    const sceneResult = addScene(system, 'Scene 1')
    system = sceneResult.system
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Selected_Point',
      systemName: config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_A' },
      ntst: 2,
      ncol: 1,
      period: 2,
      state: [1, 0, 0, 1, -1, 0, 2],
      createdAt: nowIso()
    }
    const limitCycleResult = addObject(system, limitCycle)
    system = limitCycleResult.system

    renderPanel(system, {
      limitCyclePointSelection: {
        limitCycleId: limitCycleResult.nodeId,
        pointIndex: 1
      }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()

    const selectedTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === `${limitCycle.name} selected point` &&
        'mode' in trace &&
        trace.mode === 'markers'
    ) as
      | {
          type?: string
          x?: number[]
          y?: number[]
          customdata?: number[]
          marker?: { symbol?: string }
          showlegend?: boolean
        }
      | undefined

    expect(selectedTrace?.type).toBe('scatter')
    expect(selectedTrace?.x).toEqual([0])
    expect(selectedTrace?.y).toEqual([1])
    expect(selectedTrace?.customdata).toEqual([1])
    expect(selectedTrace?.marker?.symbol).toBe('circle-open')
    expect(selectedTrace?.showlegend).toBe(false)

    const limitCycleTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === limitCycle.name &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { hovertemplate?: string } | undefined
    expect(limitCycleTrace?.hovertemplate).toBe(
      'x: %{x:.6g}<br>y: %{y:.6g}<extra></extra>'
    )
  })

  it('omits axis ranges from 2D layouts but seeds initialView', () => {
    let system = createSystem({ name: '2D_System' })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisRanges: { x: [-2, 2], y: [1, 3] },
      camera: {
        eye: { x: 2, y: 3, z: 4 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 }
      },
      viewRevision: 5
    })

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    expect(props?.layout?.scene).toBeUndefined()
    expect(props?.layout?.xaxis?.range).toBeUndefined()
    expect(props?.layout?.yaxis?.range).toBeUndefined()
    expect(props?.layout?.xaxis?.title).toMatchObject({ text: 'x' })
    expect(props?.layout?.yaxis?.title).toMatchObject({ text: 'y' })
    expect(props?.viewRevision).toBe(5)
    expect(props?.initialView).toMatchObject({
      'xaxis.range': [-2, 2],
      'yaxis.range': [1, 3]
    })
  })

  it('renders 2D map scene axis titles from state variable names', () => {
    const config: SystemConfig = {
      name: 'Map2D',
      equations: ['x', 'y'],
      params: [],
      paramNames: [],
      varNames: ['u', 'v'],
      solver: 'discrete',
      type: 'map'
    }
    let system = createSystem({ name: 'Map2D_System', config })
    const sceneResult = addScene(system, 'Scene Map 2D')
    system = sceneResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Map2DOrbit',
      systemName: config.name,
      data: [
        [0, 1, 2],
        [1, 1.5, 2.5],
        [2, 2, 3]
      ],
      t_start: 0,
      t_end: 2,
      dt: 1
    }
    system = addObject(system, orbit).system

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    expect(props?.layout?.scene).toBeUndefined()
    expect(props?.layout?.xaxis?.title).toMatchObject({ text: 'u' })
    expect(props?.layout?.yaxis?.title).toMatchObject({ text: 'v' })
    const orbitTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === orbit.name &&
        'mode' in trace &&
        trace.mode === 'markers'
    ) as { hovertemplate?: string; text?: string[] } | undefined
    expect(orbitTrace?.hovertemplate).toBe(
      'u: %{x:.6g}<br>v: %{y:.6g}<br>n: %{text}<extra></extra>'
    )
    expect(orbitTrace?.text).toEqual(['0', '1', '2'])
  })

  it('renders 4D flow scenes as time series when axis count is 1', () => {
    const config: SystemConfig = {
      name: 'Flow4D',
      equations: ['x', 'y', 'z', 'w'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z', 'w'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: 'Flow4D_System', config })
    const sceneResult = addScene(system, 'Flow Scene 1D')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['w']
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit4D',
      systemName: config.name,
      data: [
        [0, 0, 1, 2, 3],
        [0.1, 0.2, 1.1, 2.1, 3.2],
        [0.2, 0.4, 1.2, 2.2, 3.4]
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1
    }
    system = addObject(system, orbit).system

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    expect(props?.layout?.scene).toBeUndefined()
    expect(props?.layout?.xaxis?.title).toMatchObject({ text: 't' })
    expect(props?.layout?.yaxis?.title).toMatchObject({ text: 'w' })
    const orbitTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === orbit.name &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as
      | { x?: number[]; y?: number[]; hovertemplate?: string; text?: string[] }
      | undefined
    expect(orbitTrace?.x).toEqual([0, 0.1, 0.2])
    expect(orbitTrace?.y).toEqual([3, 3.2, 3.4])
    expect(orbitTrace?.hovertemplate).toBe(
      't: %{text}<br>w: %{y:.6g}<extra></extra>'
    )
    expect(orbitTrace?.text).toEqual(['0.000', '0.100', '0.200'])
  })

  it('renders 4D flow scenes as 2D projections when axis count is 2', () => {
    const config: SystemConfig = {
      name: 'Flow4D',
      equations: ['x', 'y', 'z', 'w'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z', 'w'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: 'Flow4D_System', config })
    const sceneResult = addScene(system, 'Flow Scene 2D')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['z', 'x']
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit4D',
      systemName: config.name,
      data: [
        [0, 0, 1, 2, 3],
        [0.1, 0.2, 1.1, 2.1, 3.2],
        [0.2, 0.4, 1.2, 2.2, 3.4]
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1
    }
    system = addObject(system, orbit).system

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    expect(props?.layout?.scene).toBeUndefined()
    expect(props?.layout?.xaxis?.title).toMatchObject({ text: 'z' })
    expect(props?.layout?.yaxis?.title).toMatchObject({ text: 'x' })
    const orbitTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === orbit.name &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as
      | { x?: number[]; y?: number[]; hovertemplate?: string; text?: string[] }
      | undefined
    expect(orbitTrace?.x).toEqual([2, 2.1, 2.2])
    expect(orbitTrace?.y).toEqual([0, 0.2, 0.4])
    expect(orbitTrace?.hovertemplate).toBe(
      'z: %{x:.6g}<br>x: %{y:.6g}<br>t: %{text}<extra></extra>'
    )
    expect(orbitTrace?.text).toEqual(['0.000', '0.100', '0.200'])
  })

  it('renders 4D map scenes as 1D cobweb projections without map function curve', () => {
    const config: SystemConfig = {
      name: 'Map4D',
      equations: ['x + y', 'y + z', 'z + w', 'w + x'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z', 'w'],
      solver: 'discrete',
      type: 'map'
    }
    let system = createSystem({ name: 'Map4D_System', config })
    const sceneResult = addScene(system, 'Map Scene 1D')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['z']
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'MapOrbit4D',
      systemName: config.name,
      data: [
        [0, 0, 1, 2, 3],
        [1, 0.2, 1.1, 2.1, 3.2],
        [2, 0.4, 1.3, 2.4, 3.4]
      ],
      t_start: 0,
      t_end: 2,
      dt: 1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    expect(props?.layout?.scene).toBeUndefined()
    expect(props?.layout?.xaxis?.title).toMatchObject({ text: 'z_n' })
    expect(props?.layout?.yaxis?.title).toMatchObject({ text: 'z_{n+1}' })
    const hasDiagonal = props?.data.some(
      (trace) =>
        'line' in trace &&
        trace.line &&
        typeof trace.line === 'object' &&
        'dash' in trace.line &&
        trace.line.dash === 'dot'
    )
    expect(hasDiagonal).toBe(true)
    const cobwebTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === orbitResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'lines'
    )
    expect(cobwebTrace).toBeTruthy()
    const orbitMarkerTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === orbitResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'markers'
    ) as { hovertemplate?: string; text?: string[] } | undefined
    expect(orbitMarkerTrace?.hovertemplate).toBe(
      'z_n: %{x:.6g}<br>z_{n+1}: %{y:.6g}<br>n: %{text}<extra></extra>'
    )
    expect(orbitMarkerTrace?.text).toEqual(['0', '1', '2'])
    const hasFunctionCurve = props?.data.some(
      (trace) =>
        'line' in trace &&
        trace.line &&
        typeof trace.line === 'object' &&
        'color' in trace.line &&
        trace.line.color === '#6f7a89'
    )
    expect(hasFunctionCurve).toBe(false)
  })

  it('keeps cobweb suffixes inside MathJax-wrapped variable labels', () => {
    const config: SystemConfig = {
      name: 'Map4DMath',
      equations: ['x + y', 'y + z', 'z + w', 'w + x'],
      params: [],
      paramNames: [],
      varNames: ['$x$', '$y$', '$z$', '$w$'],
      solver: 'discrete',
      type: 'map'
    }
    let system = createSystem({ name: 'Map4DMath_System', config })
    const sceneResult = addScene(system, 'Map Scene Math 1D')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['$z$']
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'MapOrbit4DMath',
      systemName: config.name,
      data: [
        [0, 0, 1, 2, 3],
        [1, 0.2, 1.1, 2.1, 3.2],
        [2, 0.4, 1.3, 2.4, 3.4]
      ],
      t_start: 0,
      t_end: 2,
      dt: 1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    expect(props?.layout?.xaxis?.title).toMatchObject({ text: '$z_n$' })
    expect(props?.layout?.yaxis?.title).toMatchObject({ text: '$z_{n+1}$' })
    const orbitMarkerTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === orbitResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'markers'
    ) as { hovertemplate?: string } | undefined
    expect(orbitMarkerTrace?.hovertemplate).toBe(
      '$z_n$: %{x:.6g}<br>$z_{n+1}$: %{y:.6g}<br>n: %{text}<extra></extra>'
    )
  })

  it('suppresses CLV and eigenvector overlays in 1D scene projections', () => {
    const config: SystemConfig = {
      name: 'Flow4D',
      equations: ['x', 'y', 'z', 'w'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z', 'w'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: 'Flow4D_System', config })
    const sceneResult = addScene(system, 'Flow Scene 1D')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['w']
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit4D',
      systemName: config.name,
      data: [
        [0, 0, 1, 2, 3],
        [0.1, 0.2, 1.1, 2.1, 3.2],
        [0.2, 0.4, 1.2, 2.2, 3.4]
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1,
      covariantVectors: {
        dim: 4,
        times: [0, 0.1, 0.2],
        vectors: [[[1, 0, 0, 0]], [[1, 0, 0, 0]], [[1, 0, 0, 0]]]
      }
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system
    system.nodes[orbitResult.nodeId].render.clv = {
      enabled: true,
      stride: 1,
      lengthScale: 1,
      headScale: 1,
      thickness: 1,
      vectorIndices: [0],
      colors: ['#ff0000']
    }

    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq4D',
      systemName: config.name,
      solution: {
        state: [0.1, 0.2, 0.3, 0.4],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [
          {
            value: { re: 0.5, im: 0 },
            vector: [
              { re: 1, im: 0 },
              { re: 0, im: 0 },
              { re: 0, im: 0 },
              { re: 0, im: 0 }
            ]
          }
        ]
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    system.nodes[equilibriumResult.nodeId].render.equilibriumEigenvectors = {
      enabled: true,
      stride: 1,
      vectorIndices: [0],
      colors: ['#00ff00'],
      lineLengthScale: 1,
      lineThickness: 1,
      discRadiusScale: 1,
      discThickness: 1
    }

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const orbitTraces = props?.data.filter(
      (trace) => 'uid' in trace && trace.uid === orbitResult.nodeId
    )
    expect(orbitTraces?.length).toBe(1)
    const hasEigenvectorColorTrace = props?.data.some(
      (trace) =>
        'uid' in trace &&
        trace.uid === equilibriumResult.nodeId &&
        'line' in trace &&
        trace.line &&
        typeof trace.line === 'object' &&
        'color' in trace.line &&
        trace.line.color === '#00ff00'
    )
    const hasConeTrace = props?.data.some((trace) => trace.type === 'cone')
    expect(hasEigenvectorColorTrace).toBe(false)
    expect(hasConeTrace).toBe(false)
  })

  it('marks autorange when a stored axis range is null', () => {
    let system = createSystem({ name: 'Auto_System' })
    const sceneResult = addScene(system, 'Scene Auto')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisRanges: { x: null, y: [0, 2] },
      viewRevision: 1
    })

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    expect(props?.initialView).toMatchObject({
      'xaxis.autorange': true,
      'yaxis.range': [0, 2]
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
      type: 'flow'
    }
    let system = createSystem({ name: '3D_System', config })
    const sceneResult = addScene(system, 'Scene 3D')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      camera: {
        eye: { x: 4, y: 5, z: 6 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 }
      },
      viewRevision: 2
    })

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    expect(props?.layout?.scene?.camera).toBeUndefined()
    expect(props?.layout?.scene?.aspectmode).toBe('cube')
    expect(props?.viewRevision).toBe(2)
    expect(props?.initialView).toMatchObject({
      'scene.camera': {
        eye: { x: 4, y: 5, z: 6 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 }
      }
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
      type: 'flow'
    }
    let system = createSystem({ name: '3D_Missing_Camera', config })
    const sceneResult = addScene(system, 'Scene 3D')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      camera: undefined as unknown as Scene['camera'],
      viewRevision: 1
    })

    expect(() => renderPanel(system)).not.toThrow()

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    expect(props?.initialView).toBeNull()
  })

  it('renders cached 2D isocline segments in scene traces', () => {
    let system = createSystem({ name: 'Iso2D' })
    const sceneResult = addScene(system, 'Scene Iso 2D')
    system = sceneResult.system
    const isocline: IsoclineObject = {
      type: 'isocline',
      name: 'Iso_Segments',
      systemName: system.config.name,
      source: { kind: 'custom', expression: 'x + y' },
      level: 0,
      axes: [
        { variableName: 'x', min: -2, max: 2, samples: 24 },
        { variableName: 'y', min: -2, max: 2, samples: 24 }
      ],
      frozenState: [0, 0],
      parameters: [...system.config.params],
      lastComputed: {
        source: { kind: 'custom', expression: 'x + y' },
        expression: 'x + y',
        level: 0,
        axes: [
          { variableName: 'x', min: -2, max: 2, samples: 24 },
          { variableName: 'y', min: -2, max: 2, samples: 24 }
        ],
        frozenState: [0, 0],
        parameters: [...system.config.params],
        computedAt: nowIso()
      }
    }
    const added = addObject(system, isocline)
    const signature = buildIsoclineSignature(isocline)

    renderPanel(added.system, {
      isoclineGeometryCache: {
        [added.nodeId]: {
          signature,
          geometry: {
            geometry: 'segments',
            dim: 2,
            points: [-1, 0, 1, 0],
            segments: [0, 1]
          }
        }
      }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const trace = props?.data.find(
      (entry) =>
        'uid' in entry &&
        entry.uid === added.nodeId &&
        'mode' in entry &&
        entry.mode === 'lines'
    ) as { x?: Array<number | null>; y?: Array<number | null> } | undefined
    expect(trace).toBeTruthy()
    expect(trace?.x).toEqual([-1, 1, null])
    expect(trace?.y).toEqual([0, 0, null])
  })

  it('renders limit cycle object traces from homoclinic branch render targets', () => {
    let system = createSystem({
      name: 'LC_Render_Homoc',
      config: {
        name: 'LC_Render_Homoc',
        equations: ['y', '-x'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow'
      }
    })
    const sceneResult = addScene(system, 'Scene LC')
    system = sceneResult.system
    const lcObject: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_A',
      systemName: system.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_A' },
      ntst: 2,
      ncol: 1,
      period: 1,
      state: [0, 0, 1, 0, 2, 0, 0.5, 0, 1.5, 0, 1],
      createdAt: nowIso()
    }
    const addedObject = addObject(system, lcObject)
    const homocBranch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_child',
      systemName: system.config.name,
      parameterName: 'mu, nu',
      parentObject: lcObject.name,
      startObject: lcObject.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: [
              0, 0, 1, 0, 2, 0, 0.5, 0, 1.5, 0, 0, 0, 0.25, 8, 0.02, 0, 0
            ],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 2,
          ncol: 1,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: true,
          free_eps0: true,
          free_eps1: false
        }
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 5,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6
      } as ContinuationSettings,
      timestamp: nowIso(),
      params: [0.2, 0.1]
    }
    const addedBranch = addBranch(
      addedObject.system,
      homocBranch,
      addedObject.nodeId
    )
    system = updateLimitCycleRenderTarget(
      addedBranch.system,
      addedObject.nodeId,
      {
        type: 'branch',
        branchId: addedBranch.nodeId,
        pointIndex: 0
      }
    )

    renderPanel(system)

    const sceneId = sceneResult.nodeId
    const props = plotlyCalls.find((entry) => entry.plotId === sceneId)
    expect(props).toBeTruthy()
    const trace = props?.data.find(
      (entry) =>
        'uid' in entry && entry.uid === addedObject.nodeId && 'mode' in entry
    ) as
      | { mode?: string; x?: Array<number | null>; y?: Array<number | null> }
      | undefined
    expect(trace).toBeTruthy()
    expect(trace?.mode).toBe('lines')
    expect((trace?.x?.length ?? 0) > 2).toBe(true)
    expect((trace?.y?.length ?? 0) > 2).toBe(true)
    expect(trace?.x?.[0]).toBe(0)
    expect(trace?.y?.[0]).toBe(0)
    expect(trace?.x?.[trace.x.length - 1]).toBe(0)
    expect(trace?.y?.[trace.y.length - 1]).toBe(0)

    const closureMarker = props?.data.find(
      (entry) =>
        'uid' in entry &&
        entry.uid === addedObject.nodeId &&
        'mode' in entry &&
        entry.mode === 'markers' &&
        'name' in entry &&
        entry.name === `${lcObject.name} equilibrium`
    ) as { x?: Array<number | null>; y?: Array<number | null> } | undefined
    expect(closureMarker).toBeTruthy()
    expect(closureMarker?.x?.[0]).toBe(0)
    expect(closureMarker?.y?.[0]).toBe(0)
  })

  it('renders limit-cycle Floquet eigenlines even when using a branch render target', () => {
    let system = createSystem({
      name: 'LC_Floquet_Render_Target',
      config: {
        name: 'LC_Floquet_Render_Target',
        equations: ['y', '-x'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow'
      }
    })
    const sceneResult = addScene(system, 'Scene LC Floquet')
    system = sceneResult.system
    const cycleState = [1, 0, 0, 1, -1, 0, 0, -1, 1, 0, 1]
    const lcObject: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Floquet',
      systemName: system.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Floquet' },
      ntst: 2,
      ncol: 1,
      period: 1,
      state: cycleState,
      floquetMultipliers: [
        { re: 1, im: 0 },
        { re: 0.8, im: 0 }
      ],
      floquetModes: {
        ntst: 2,
        ncol: 1,
        multipliers: [
          { re: 1, im: 0 },
          { re: 0.8, im: 0 }
        ],
        vectors: Array.from({ length: 5 }, () => [
          [
            { re: 1, im: 0 },
            { re: 0, im: 0 }
          ],
          [
            { re: 0, im: 0 },
            { re: 1, im: 0 }
          ]
        ]),
        computedAt: nowIso()
      },
      createdAt: nowIso()
    }
    const addedObject = addObject(system, lcObject)
    const lcBranch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_floquet_mu',
      systemName: system.config.name,
      parameterName: 'mu',
      parentObject: lcObject.name,
      startObject: lcObject.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: cycleState,
            param_value: 0.2,
            stability: 'Stable',
            eigenvalues: [
              { re: 1, im: 0 },
              { re: 0.8, im: 0 }
            ]
          }
        ],
        bifurcations: [],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 2, ncol: 1 }
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 5,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6
      } as ContinuationSettings,
      timestamp: nowIso(),
      params: [0.2]
    }
    const addedBranch = addBranch(
      addedObject.system,
      lcBranch,
      addedObject.nodeId
    )
    system = updateLimitCycleRenderTarget(
      addedBranch.system,
      addedObject.nodeId,
      {
        type: 'branch',
        branchId: addedBranch.nodeId,
        pointIndex: 0
      }
    )
    system.nodes[addedObject.nodeId].render.equilibriumEigenvectors = {
      enabled: true,
      stride: 1,
      vectorIndices: [0, 1],
      colors: ['#00ff00', '#ff00ff'],
      lineLengthScale: 0.2,
      lineThickness: 2,
      discRadiusScale: 0,
      discThickness: 2
    }

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const hasFloquetLine = props?.data.some(
      (trace) =>
        'uid' in trace &&
        trace.uid === addedObject.nodeId &&
        'mode' in trace &&
        trace.mode === 'lines' &&
        'line' in trace &&
        trace.line &&
        typeof trace.line === 'object' &&
        'color' in trace.line &&
        (trace.line.color === '#00ff00' || trace.line.color === '#ff00ff')
    )
    expect(hasFloquetLine).toBe(true)
  })

  it('keeps 3D eigenline lengths visually isotropic across anisotropic axis spans', () => {
    const config: SystemConfig = {
      name: 'Eigenline_Anisotropic_3D',
      equations: ['x', 'y', 'z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene Eigenline 3D')
    system = sceneResult.system

    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Bounds',
      systemName: config.name,
      data: [
        [0, 0, 0, 0],
        [0.5, 500, 0.5, 0.5],
        [1, 1000, 1, 1]
      ],
      t_start: 0,
      t_end: 1,
      dt: 0.5
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system

    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Anisotropic',
      systemName: config.name,
      solution: {
        state: [500, 0.5, 0.5],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [
          {
            value: { re: 0.9, im: 0 },
            vector: [
              { re: 1, im: 0 },
              { re: 0, im: 0 },
              { re: 0, im: 0 }
            ]
          },
          {
            value: { re: 0.8, im: 0 },
            vector: [
              { re: 0, im: 0 },
              { re: 1, im: 0 },
              { re: 0, im: 0 }
            ]
          }
        ]
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    system.nodes[equilibriumResult.nodeId].render.equilibriumEigenvectors = {
      enabled: true,
      stride: 1,
      vectorIndices: [0, 1],
      colors: ['#00ff00', '#ff00ff'],
      lineLengthScale: 0.2,
      lineThickness: 2,
      discRadiusScale: 0,
      discThickness: 2
    }

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const xLine = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === equilibriumResult.nodeId &&
        'type' in trace &&
        trace.type === 'scatter3d' &&
        'mode' in trace &&
        trace.mode === 'lines' &&
        'line' in trace &&
        trace.line &&
        typeof trace.line === 'object' &&
        'color' in trace.line &&
        trace.line.color === '#00ff00'
    ) as { x?: number[]; y?: number[] } | undefined
    const yLine = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === equilibriumResult.nodeId &&
        'type' in trace &&
        trace.type === 'scatter3d' &&
        'mode' in trace &&
        trace.mode === 'lines' &&
        'line' in trace &&
        trace.line &&
        typeof trace.line === 'object' &&
        'color' in trace.line &&
        trace.line.color === '#ff00ff'
    ) as { x?: number[]; y?: number[] } | undefined
    expect(xLine).toBeTruthy()
    expect(yLine).toBeTruthy()

    const xSpan = Math.abs((xLine?.x?.[1] ?? 0) - (xLine?.x?.[0] ?? 0))
    const ySpan = Math.abs((yLine?.y?.[1] ?? 0) - (yLine?.y?.[0] ?? 0))
    expect(xSpan / 1000).toBeCloseTo(ySpan, 3)
  })

  it('renders 3D eigendisks as axis-compensated ellipses in anisotropic scenes', () => {
    const config: SystemConfig = {
      name: 'Eigendisk_Anisotropic_3D',
      equations: ['x', 'y', 'z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene Eigendisk 3D')
    system = sceneResult.system

    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Bounds',
      systemName: config.name,
      data: [
        [0, 0, 0, 0],
        [1, 1000, 1, 1]
      ],
      t_start: 0,
      t_end: 1,
      dt: 1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system

    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Complex',
      systemName: config.name,
      solution: {
        state: [500, 0.5, 0.5],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [
          {
            value: { re: 0.7, im: 0.3 },
            vector: [
              { re: 1, im: 0 },
              { re: 0, im: 1 },
              { re: 0, im: 0 }
            ]
          }
        ]
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    system.nodes[equilibriumResult.nodeId].render.equilibriumEigenvectors = {
      enabled: true,
      stride: 1,
      vectorIndices: [0],
      colors: ['#ffaa00'],
      lineLengthScale: 0.2,
      lineThickness: 2,
      discRadiusScale: 0.2,
      discThickness: 2
    }

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const discOutline = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === equilibriumResult.nodeId &&
        'type' in trace &&
        trace.type === 'scatter3d' &&
        'mode' in trace &&
        trace.mode === 'lines' &&
        'line' in trace &&
        trace.line &&
        typeof trace.line === 'object' &&
        'color' in trace.line &&
        trace.line.color === '#ffaa00'
    ) as { x?: number[]; y?: number[] } | undefined
    expect(discOutline).toBeTruthy()
    const xValues = (discOutline?.x ?? []).filter((value) =>
      Number.isFinite(value)
    )
    const yValues = (discOutline?.y ?? []).filter((value) =>
      Number.isFinite(value)
    )
    expect(xValues.length).toBeGreaterThan(2)
    expect(yValues.length).toBeGreaterThan(2)
    const xSpan = Math.max(...xValues) - Math.min(...xValues)
    const ySpan = Math.max(...yValues) - Math.min(...yValues)
    expect(xSpan / 1000).toBeCloseTo(ySpan, 2)
  })

  it('renders cached 1D isocline points as diagonal markers in map scenes', () => {
    const config: SystemConfig = {
      name: 'IsoMap1D',
      equations: ['r * x * (1 - x)'],
      params: [2.5],
      paramNames: ['r'],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene Iso 1D')
    system = sceneResult.system
    const isocline: IsoclineObject = {
      type: 'isocline',
      name: 'Iso_Points',
      systemName: config.name,
      source: { kind: 'custom', expression: 'x' },
      level: 0,
      axes: [{ variableName: 'x', min: 0, max: 1, samples: 32 }],
      frozenState: [0],
      parameters: [...config.params],
      lastComputed: {
        source: { kind: 'custom', expression: 'x' },
        expression: 'x',
        level: 0,
        axes: [{ variableName: 'x', min: 0, max: 1, samples: 32 }],
        frozenState: [0],
        parameters: [...config.params],
        computedAt: nowIso()
      }
    }
    const added = addObject(system, isocline)
    const signature = buildIsoclineSignature(isocline)

    renderPanel(added.system, {
      isoclineGeometryCache: {
        [added.nodeId]: {
          signature,
          geometry: {
            geometry: 'points',
            dim: 1,
            points: [0.25, 0.75]
          }
        }
      }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const trace = props?.data.find(
      (entry) =>
        'uid' in entry &&
        entry.uid === added.nodeId &&
        'mode' in entry &&
        entry.mode === 'markers'
    ) as { x?: number[]; y?: number[] } | undefined
    expect(trace).toBeTruthy()
    expect(trace?.x).toEqual([0.25, 0.75])
    expect(trace?.y).toEqual([0.25, 0.75])
  })

  it('renders cached 1D isocline points as dotted horizontal lines in matching flow timeseries scenes', () => {
    const config: SystemConfig = {
      name: 'IsoFlow1D',
      equations: ['x + y', 'x - y'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene Iso Flow 1D')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['y']
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Y',
      systemName: config.name,
      data: [
        [0, 0, -0.2],
        [0.5, 0.1, 0.1],
        [1, 0.2, 0.3]
      ],
      t_start: 0,
      t_end: 1,
      dt: 0.5
    }
    system = addObject(system, orbit).system
    const subsystemSnapshot = buildSubsystemSnapshot(
      config,
      { frozenValuesByVarName: { x: 0 } },
      { maxFreeVariables: 3 }
    )
    const isocline: IsoclineObject = {
      type: 'isocline',
      name: 'Iso_Y',
      systemName: config.name,
      source: { kind: 'custom', expression: 'y' },
      level: 0,
      axes: [{ variableName: 'y', min: -1, max: 1, samples: 48 }],
      frozenState: [0, 0],
      parameters: [],
      lastComputed: {
        source: { kind: 'custom', expression: 'y' },
        expression: 'y',
        level: 0,
        axes: [{ variableName: 'y', min: -1, max: 1, samples: 48 }],
        frozenState: [0, 0],
        parameters: [],
        computedAt: nowIso(),
        subsystemSnapshot
      },
      subsystemSnapshot
    }
    const added = addObject(system, isocline)
    const signature = buildIsoclineSignature(isocline)

    renderPanel(added.system, {
      isoclineGeometryCache: {
        [added.nodeId]: {
          signature,
          geometry: {
            geometry: 'points',
            dim: 1,
            points: [0.25]
          }
        }
      }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const lineTrace = props?.data.find(
      (entry) =>
        'uid' in entry &&
        entry.uid === added.nodeId &&
        'mode' in entry &&
        entry.mode === 'lines'
    ) as
      | {
          x?: Array<number | null>
          y?: Array<number | null>
          line?: { dash?: string }
        }
      | undefined
    expect(lineTrace).toBeTruthy()
    expect(lineTrace?.x).toEqual([0, 1, null])
    expect(lineTrace?.y).toEqual([0.25, 0.25, null])
    expect(lineTrace?.line?.dash).toBe('dot')
    const markerTrace = props?.data.find(
      (entry) =>
        'uid' in entry &&
        entry.uid === added.nodeId &&
        'mode' in entry &&
        entry.mode === 'markers'
    )
    expect(markerTrace).toBeUndefined()
  })

  it('keeps cached 1D flow isocline points as markers when scene axis does not match free variable', () => {
    const config: SystemConfig = {
      name: 'IsoFlow1DMismatch',
      equations: ['x + y', 'x - y'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene Iso Flow 1D Mismatch')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x']
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_X',
      systemName: config.name,
      data: [
        [0, -0.2, 0],
        [1, 0.3, 0.1]
      ],
      t_start: 0,
      t_end: 1,
      dt: 1
    }
    system = addObject(system, orbit).system
    const subsystemSnapshot = buildSubsystemSnapshot(
      config,
      { frozenValuesByVarName: { x: 0 } },
      { maxFreeVariables: 3 }
    )
    const isocline: IsoclineObject = {
      type: 'isocline',
      name: 'Iso_Y_Mismatch',
      systemName: config.name,
      source: { kind: 'custom', expression: 'y' },
      level: 0,
      axes: [{ variableName: 'y', min: -1, max: 1, samples: 48 }],
      frozenState: [0, 0],
      parameters: [],
      lastComputed: {
        source: { kind: 'custom', expression: 'y' },
        expression: 'y',
        level: 0,
        axes: [{ variableName: 'y', min: -1, max: 1, samples: 48 }],
        frozenState: [0, 0],
        parameters: [],
        computedAt: nowIso(),
        subsystemSnapshot
      },
      subsystemSnapshot
    }
    const added = addObject(system, isocline)
    const signature = buildIsoclineSignature(isocline)

    renderPanel(added.system, {
      isoclineGeometryCache: {
        [added.nodeId]: {
          signature,
          geometry: {
            geometry: 'points',
            dim: 1,
            points: [0.25]
          }
        }
      }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const markerTrace = props?.data.find(
      (entry) =>
        'uid' in entry &&
        entry.uid === added.nodeId &&
        'mode' in entry &&
        entry.mode === 'markers'
    ) as { x?: number[]; y?: number[] } | undefined
    expect(markerTrace).toBeTruthy()
    expect(markerTrace?.x).toEqual([0])
    expect(markerTrace?.y).toEqual([0.25])
    const lineTrace = props?.data.find(
      (entry) =>
        'uid' in entry &&
        entry.uid === added.nodeId &&
        'mode' in entry &&
        entry.mode === 'lines'
    )
    expect(lineTrace).toBeUndefined()
  })

  it('renders cached 3D isocline triangles as meshes', () => {
    const config: SystemConfig = {
      name: 'Iso3D',
      equations: ['x', 'y', 'z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene Iso 3D')
    system = sceneResult.system
    const isocline: IsoclineObject = {
      type: 'isocline',
      name: 'Iso_Mesh',
      systemName: config.name,
      source: { kind: 'custom', expression: 'x + y + z' },
      level: 0,
      axes: [
        { variableName: 'x', min: -1, max: 1, samples: 8 },
        { variableName: 'y', min: -1, max: 1, samples: 8 },
        { variableName: 'z', min: -1, max: 1, samples: 8 }
      ],
      frozenState: [0, 0, 0],
      parameters: [],
      lastComputed: {
        source: { kind: 'custom', expression: 'x + y + z' },
        expression: 'x + y + z',
        level: 0,
        axes: [
          { variableName: 'x', min: -1, max: 1, samples: 8 },
          { variableName: 'y', min: -1, max: 1, samples: 8 },
          { variableName: 'z', min: -1, max: 1, samples: 8 }
        ],
        frozenState: [0, 0, 0],
        parameters: [],
        computedAt: nowIso()
      }
    }
    const added = addObject(system, isocline)
    const signature = buildIsoclineSignature(isocline)

    renderPanel(added.system, {
      isoclineGeometryCache: {
        [added.nodeId]: {
          signature,
          geometry: {
            geometry: 'triangles',
            dim: 3,
            points: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            triangles: [0, 1, 2]
          }
        }
      }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const meshTrace = props?.data.find(
      (entry) =>
        'uid' in entry && entry.uid === added.nodeId && entry.type === 'mesh3d'
    ) as { x?: number[]; i?: Uint32Array | number[] } | undefined
    expect(meshTrace).toBeTruthy()
    expect(meshTrace?.x).toEqual([0, 1, 0])
    expect(Array.from(meshTrace?.i ?? [])).toEqual([0])
  })

  it('omits diagram ranges from layout but seeds initialView', () => {
    let system = createSystem({ name: 'Diagram_System' })
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(
      diagramResult.system,
      diagramResult.nodeId,
      {
        axisRanges: { x: [-3, 3], y: [2, 4] },
        viewRevision: 7
      }
    )

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === diagramResult.nodeId
    )
    expect(props).toBeTruthy()
    const tile = document.querySelector(
      `[data-testid="viewport-tile-${diagramResult.nodeId}"]`
    )
    expect(tile).toBeTruthy()
    expect(tile?.classList.contains('viewport-tile--diagram')).toBe(true)
    expect(props?.layout?.xaxis?.range).toBeUndefined()
    expect(props?.layout?.yaxis?.range).toBeUndefined()
    expect(props?.viewRevision).toBe(7)
    expect(props?.initialView).toMatchObject({
      'xaxis.range': [-3, 3],
      'yaxis.range': [2, 4]
    })
    expect(props?.layout?.legend).toMatchObject({
      itemclick: false,
      itemdoubleclick: false
    })
  })

  it('shows selected branch points on bifurcation diagrams', () => {
    const config: SystemConfig = {
      name: 'Selection_System',
      equations: ['x'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x'],
      solver: 'rk4',
      type: 'flow'
    }
    const defaultSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-5,
      max_step_size: 0.1,
      max_steps: 100,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    let system = createSystem({ name: 'Selection_System', config })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit A',
      systemName: config.name,
      data: [
        [0, 0.1],
        [0.1, 0.2]
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
      parameters: [...config.params]
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_branch',
      systemName: config.name,
      parameterName: 'mu',
      parentObject: orbit.name,
      startObject: orbit.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0.4],
            param_value: 1.1,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [0.8],
            param_value: 1.3,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: { type: 'Equilibrium' }
      },
      settings: defaultSettings,
      timestamp: nowIso(),
      params: [...config.params]
    }
    const branchResult = addBranch(system, branch, orbitResult.nodeId)
    system = branchResult.system
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(
      diagramResult.system,
      diagramResult.nodeId,
      {
        xAxis: { kind: 'parameter', name: 'mu' },
        yAxis: { kind: 'state', name: 'x' }
      }
    )

    renderPanel(system, {
      branchPointSelection: { branchId: branchResult.nodeId, pointIndex: 1 }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === diagramResult.nodeId
    )
    expect(props).toBeTruthy()
    const selectedTrace = props?.data.find(
      (trace) => trace.name === 'eq_branch selected point'
    ) as { x?: number[]; y?: number[]; customdata?: number[] } | undefined
    expect(selectedTrace).toBeTruthy()
    expect(selectedTrace?.x).toEqual([1.3])
    expect(selectedTrace?.y).toEqual([0.8])
    expect(selectedTrace?.customdata).toEqual([1])
  })

  it('renders frozen state-axis values from continuation parameter refs', () => {
    const config: SystemConfig = {
      name: 'Frozen_Axis_Diagram',
      equations: ['y', 'x - z', '0.1 * (x - z)'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed',
      systemName: config.name,
      solution: {
        state: [0.2, 0.1, -1.5],
        residual_norm: 0,
        iterations: 0,
        jacobian: [],
        eigenpairs: []
      },
      frozenVariables: { frozenValuesByVarName: { x: 0.2, z: -1.5 } },
      subsystemSnapshot: buildSubsystemSnapshot(config, {
        frozenValuesByVarName: { x: 0.2, z: -1.5 }
      })
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_frozen_branch',
      systemName: config.name,
      parameterName: 'var:x',
      parameterRef: { kind: 'frozen_var', variableName: 'x' },
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0.1],
            param_value: 0.25,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [0.3],
            param_value: 0.55,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: { type: 'Equilibrium' }
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 10,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6
      },
      timestamp: nowIso(),
      params: [...config.params],
      subsystemSnapshot: equilibrium.subsystemSnapshot
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = branchResult.system
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(
      diagramResult.system,
      diagramResult.nodeId,
      {
        xAxis: { kind: 'state', name: 'x' },
        yAxis: { kind: 'state', name: 'y' }
      }
    )

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === diagramResult.nodeId
    )
    expect(props).toBeTruthy()
    const mainTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === branch.name &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { x?: number[]; y?: number[] } | undefined
    expect(mainTrace?.x).toEqual([0.25, 0.55])
    expect(mainTrace?.y).toEqual([0.1, 0.3])
  })

  it('renders scene equilibrium branches as lines with dedicated bifurcation markers', () => {
    const config: SystemConfig = {
      name: 'Scene_Equilibrium_Branch',
      equations: ['y', '-x + mu'],
      params: [0.3],
      paramNames: ['mu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x', 'y']
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed',
      systemName: config.name,
      solution: {
        state: [0.1, 0],
        residual_norm: 0,
        iterations: 0,
        jacobian: [0, 1, -1, 0],
        eigenpairs: []
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const continuationSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_scene_branch',
      systemName: config.name,
      parameterName: 'mu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0.1, 0],
            param_value: 0.3,
            stability: 'Stable',
            eigenvalues: []
          },
          {
            state: [0.4, 0],
            param_value: 0.6,
            stability: 'Hopf',
            eigenvalues: []
          },
          {
            state: [0.7, 0],
            param_value: 0.9,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [1],
        indices: [0, 1, 2],
        branch_type: { type: 'Equilibrium' }
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params]
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = branchResult.system

    renderPanel(system, {
      branchPointSelection: { branchId: branchResult.nodeId, pointIndex: 1 }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const branchLineTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === branch.name &&
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as
      | { x?: number[]; y?: number[]; text?: string[]; hovertemplate?: string }
      | undefined
    expect(branchLineTrace).toBeTruthy()
    expect(branchLineTrace?.x).toEqual([0.1, 0.4, 0.7])
    expect(branchLineTrace?.y).toEqual([0, 0, 0])
    expect(branchLineTrace?.text).toEqual(['mu: 0.3', 'mu: 0.6', 'mu: 0.9'])
    expect(branchLineTrace?.hovertemplate).toContain('%{text}')

    const bifTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === `${branch.name} bifurcations` &&
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'markers'
    ) as
      | {
          x?: number[]
          y?: number[]
          customdata?: number[]
          text?: string[]
          marker?: { symbol?: string }
        }
      | undefined
    expect(bifTrace).toBeTruthy()
    expect(bifTrace?.x).toEqual([0.4])
    expect(bifTrace?.y).toEqual([0])
    expect(bifTrace?.customdata).toEqual([1])
    expect(bifTrace?.text?.[0]).toContain('mu: 0.6')
    expect(bifTrace?.marker?.symbol).toBe('diamond')

    const selectedTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === `${branch.name} selected point` &&
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'markers'
    ) as
      | {
          x?: number[]
          y?: number[]
          customdata?: number[]
          marker?: { symbol?: string }
        }
      | undefined
    expect(selectedTrace?.x).toEqual([0.4])
    expect(selectedTrace?.y).toEqual([0])
    expect(selectedTrace?.customdata).toEqual([1])
    expect(selectedTrace?.marker?.symbol).toBe('circle-open')
  })

  it('renders scene fold curves as lines and only shows codim-2 markers', () => {
    const config: SystemConfig = {
      name: 'Scene_Fold_Curve',
      equations: ['y', '-x + mu'],
      params: [0.3, 0.2],
      paramNames: ['mu', 'nu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x', 'y']
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed',
      systemName: config.name,
      solution: {
        state: [0.1, 0],
        residual_norm: 0,
        iterations: 0,
        jacobian: [0, 1, -1, 0],
        eigenpairs: []
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const continuationSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'fold_scene_curve',
      systemName: config.name,
      parameterName: 'mu,nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'fold_curve',
      data: {
        points: [
          {
            state: [0.1, 0],
            param_value: 0.3,
            param2_value: 0.2,
            stability: 'Fold',
            eigenvalues: []
          },
          {
            state: [0.4, 0.2],
            param_value: 0.5,
            param2_value: 0.3,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [0.8, 0.4],
            param_value: 0.7,
            param2_value: 0.4,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [1],
        indices: [0, 1, 2],
        branch_type: {
          type: 'FoldCurve',
          param1_name: 'mu',
          param2_name: 'nu'
        }
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params]
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = branchResult.system

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const lineTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === branch.name &&
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as
      | { x?: number[]; y?: number[]; text?: string[]; hovertemplate?: string }
      | undefined
    expect(lineTrace?.x).toEqual([0.1, 0.4, 0.8])
    expect(lineTrace?.y).toEqual([0, 0.2, 0.4])
    expect(lineTrace?.text).toEqual([
      'mu: 0.3<br>nu: 0.2',
      'mu: 0.5<br>nu: 0.3',
      'mu: 0.7<br>nu: 0.4'
    ])
    expect(lineTrace?.hovertemplate).toContain('%{text}')

    const pointTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === branch.name &&
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'lines+markers'
    )
    expect(pointTrace).toBeUndefined()

    const bifTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === `${branch.name} bifurcations` &&
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'markers'
    ) as
      | {
          x?: number[]
          y?: number[]
          customdata?: number[]
          text?: string[]
          marker?: { symbol?: string }
        }
      | undefined
    expect(bifTrace?.x).toEqual([0.4])
    expect(bifTrace?.y).toEqual([0.2])
    expect(bifTrace?.customdata).toEqual([1])
    expect(bifTrace?.text?.[0]).toContain('mu: 0.5')
    expect(bifTrace?.text?.[0]).toContain('nu: 0.3')
    expect(bifTrace?.marker?.symbol).toBe('diamond')
  })

  it('shows bifurcation parameter values in map scene branch hover text', () => {
    const config: SystemConfig = {
      name: 'Scene_Map_Branch_Hover_Params',
      equations: ['r * x * (1 - x)'],
      params: [2.5],
      paramNames: ['r'],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x']
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Map_Seed',
      systemName: config.name,
      solution: {
        state: [0.2],
        residual_norm: 0,
        iterations: 0,
        jacobian: [0],
        eigenpairs: []
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const continuationSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'map_eq_branch',
      systemName: config.name,
      parameterName: 'r',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0.2],
            param_value: 2.5,
            stability: 'Stable',
            eigenvalues: []
          },
          {
            state: [0.4],
            param_value: 2.8,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: { type: 'Equilibrium' }
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params]
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = branchResult.system

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const lineTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === branch.name &&
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { text?: string[]; hovertemplate?: string } | undefined
    expect(lineTrace?.text).toEqual(['r: 2.5', 'r: 2.8'])
    expect(lineTrace?.hovertemplate).toContain('%{text}')
  })

  it('applies dash styles to 1D equilibrium manifold traces in scenes', () => {
    const config: SystemConfig = {
      name: 'Scene_Manifold_1D_Dash',
      equations: ['y', '-x + mu', '-z'],
      params: [0.3],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x', 'y', 'z']
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed',
      systemName: config.name,
      solution: {
        state: [0, 0, 0],
        residual_norm: 0,
        iterations: 0,
        jacobian: [0, 1, 0, -1, 0, 0, 0, 0, -1],
        eigenpairs: []
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const continuationSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_manifold_curve',
      systemName: config.name,
      parameterName: 'manifold',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_1d',
      data: {
        points: [
          {
            state: [0.1, 0, 0],
            param_value: 0,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [0.3, 0.2, 0.1],
            param_value: 0.5,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [0.7, 0.5, 0.2],
            param_value: 1.2,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1, 2],
        branch_type: {
          type: 'ManifoldEq1D',
          stability: 'Unstable',
          direction: 'Plus',
          eig_index: 0,
          method: 'shooting_bvp',
          caps: {
            max_steps: 1024,
            max_points: 2048,
            max_rings: 64,
            max_vertices: 4096,
            max_time: 25
          }
        }
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params]
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = updateNodeRender(branchResult.system, branchResult.nodeId, {
      lineStyle: 'dotted'
    })

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const manifoldTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'name' in trace &&
        trace.name === branch.name &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { line?: { dash?: string } } | undefined
    expect(manifoldTrace).toBeTruthy()
    expect(manifoldTrace?.line?.dash).toBe('dot')
  })

  it('renders 2D manifold surfaces as translucent mesh fill without ring curves', () => {
    const config: SystemConfig = {
      name: 'Scene_Manifold_2D_Rings',
      equations: ['y', '-x + mu', '-z'],
      params: [0.3],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x', 'y', 'z']
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed_2D',
      systemName: config.name,
      solution: {
        state: [0, 0, 0],
        residual_norm: 0,
        iterations: 0,
        jacobian: [0, 1, 0, -1, 0, 0, 0, 0, -1],
        eigenpairs: []
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const continuationSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_manifold_surface_rings',
      systemName: config.name,
      parameterName: 'manifold',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_2d',
      data: {
        points: [
          {
            state: [1, 0, 0],
            param_value: 0,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [0, 1, 0],
            param_value: 1,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [-1, 0, 0],
            param_value: 2,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [2, 0, 0],
            param_value: 3,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [0, 2, 0],
            param_value: 4,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [-2, 0, 0],
            param_value: 5,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1, 2, 3, 4, 5],
        branch_type: {
          type: 'ManifoldEq2D',
          stability: 'Stable',
          eig_kind: 'RealPair',
          eig_indices: [0, 1],
          method: 'leaf_shooting_bvp',
          caps: {
            max_steps: 1024,
            max_points: 4096,
            max_rings: 128,
            max_vertices: 65536,
            max_time: 100
          }
        },
        manifold_geometry: {
          type: 'Surface',
          dim: 3,
          vertices_flat: [
            1, 0, 0, 0, 1, 0, -1, 0, 0, 2, 0, 0, 0, 2, 0, -2, 0, 0
          ],
          triangles: [0, 1, 3, 1, 4, 3],
          ring_offsets: [0, 3, 6],
          ring_diagnostics: []
        }
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params]
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = updateNodeRender(branchResult.system, branchResult.nodeId, {
      lineStyle: 'dashed'
    })

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const manifoldLineTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'name' in trace &&
        trace.name === branch.name &&
        trace.type === 'scatter3d' &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { x?: Array<number | null>; line?: { dash?: string } } | undefined
    expect(manifoldLineTrace).toBeUndefined()
    const meshTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        trace.type === 'mesh3d'
    ) as
      | {
          opacity?: number
          i?: Uint32Array
          j?: Uint32Array
          k?: Uint32Array
          showlegend?: boolean
        }
      | undefined
    expect(meshTrace).toBeTruthy()
    expect(meshTrace?.opacity).toBeCloseTo(0.35)
    expect(meshTrace?.i?.length).toBe(2)
    expect(meshTrace?.j?.length).toBe(2)
    expect(meshTrace?.k?.length).toBe(2)
    expect(meshTrace?.showlegend).toBe(false)
  })

  it('phase-aligns fallback 2D manifold triangulation when stored triangles are absent', () => {
    const config: SystemConfig = {
      name: 'Scene_Manifold_2D_Fallback_Triangles',
      equations: ['y', '-x + mu', '-z'],
      params: [0.3],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x', 'y', 'z']
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Fallback_Triangles',
      systemName: config.name,
      solution: {
        state: [0, 0, 0],
        residual_norm: 0,
        iterations: 0,
        jacobian: [0, 1, 0, -1, 0, 0, 0, 0, -1],
        eigenpairs: []
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const continuationSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    const denseCount = 8
    const sparsePhases = [0.5, 0.75, 0, 0.25]
    const vertices = [
      ...Array.from({ length: denseCount }, (_, index) => {
        const theta = (index / denseCount) * Math.PI * 2
        return [Math.cos(theta), Math.sin(theta), 0]
      }),
      ...sparsePhases.map((phase) => {
        const theta = phase * Math.PI * 2
        return [2 * Math.cos(theta), 2 * Math.sin(theta), 0]
      })
    ]
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_manifold_surface_fallback_triangles',
      systemName: config.name,
      parameterName: 'manifold',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_2d',
      data: {
        points: vertices.map((state, index) => ({
          state,
          param_value: index,
          stability: 'None',
          eigenvalues: []
        })),
        bifurcations: [],
        indices: vertices.map((_, index) => index),
        branch_type: {
          type: 'ManifoldEq2D',
          stability: 'Stable',
          eig_kind: 'RealPair',
          eig_indices: [0, 1],
          method: 'leaf_shooting_bvp',
          caps: {
            max_steps: 1024,
            max_points: 4096,
            max_rings: 128,
            max_vertices: 65536,
            max_time: 100
          }
        },
        manifold_geometry: {
          type: 'Surface',
          dim: 3,
          vertices_flat: vertices.flat(),
          triangles: [],
          ring_offsets: [0, denseCount],
          ring_diagnostics: []
        }
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params]
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)

    renderPanel(branchResult.system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    const meshTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        trace.type === 'mesh3d'
    ) as { i?: Uint32Array; j?: Uint32Array; k?: Uint32Array } | undefined
    expect(meshTrace).toBeTruthy()
    expect(meshTrace?.i?.length).toBe(denseCount + sparsePhases.length)

    const phaseForIndex = (index: number) =>
      index < denseCount ? index / denseCount : (sparsePhases[index - denseCount] ?? 0)
    const circularDistance = (a: number, b: number) => {
      const distance = Math.abs(a - b)
      return Math.min(distance, 1 - distance)
    }
    const maxCrossRingPhaseGap = Array.from({ length: meshTrace?.i?.length ?? 0 }, (_, face) => [
      meshTrace?.i?.[face] ?? 0,
      meshTrace?.j?.[face] ?? 0,
      meshTrace?.k?.[face] ?? 0
    ])
      .flatMap((triangle) => [
        [triangle[0], triangle[1]],
        [triangle[1], triangle[2]],
        [triangle[2], triangle[0]]
      ])
      .filter(([a, b]) => (a < denseCount) !== (b < denseCount))
      .reduce(
        (maxGap, [a, b]) => Math.max(maxGap, circularDistance(phaseForIndex(a), phaseForIndex(b))),
        0
      )
    expect(maxCrossRingPhaseGap).toBeLessThanOrEqual(0.25 + 1e-12)
  })

  it('keeps 2D manifold ring curves but hides mesh fill when surface rendering is disabled', () => {
    const config: SystemConfig = {
      name: 'Scene_Manifold_2D_Surface_Hidden',
      equations: ['y', '-x + mu', '-z'],
      params: [0.3],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x', 'y', 'z']
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed_2D_Hidden',
      systemName: config.name,
      solution: {
        state: [0, 0, 0],
        residual_norm: 0,
        iterations: 0,
        jacobian: [0, 1, 0, -1, 0, 0, 0, 0, -1],
        eigenpairs: []
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const continuationSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_manifold_surface_hidden',
      systemName: config.name,
      parameterName: 'manifold',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_2d',
      data: {
        points: [
          { state: [1, 0, 0], param_value: 0, stability: 'None', eigenvalues: [] },
          { state: [0, 1, 0], param_value: 1, stability: 'None', eigenvalues: [] },
          { state: [-1, 0, 0], param_value: 2, stability: 'None', eigenvalues: [] },
          { state: [2, 0, 0], param_value: 3, stability: 'None', eigenvalues: [] },
          { state: [0, 2, 0], param_value: 4, stability: 'None', eigenvalues: [] },
          { state: [-2, 0, 0], param_value: 5, stability: 'None', eigenvalues: [] }
        ],
        bifurcations: [],
        indices: [0, 1, 2, 3, 4, 5],
        branch_type: {
          type: 'ManifoldEq2D',
          stability: 'Stable',
          eig_kind: 'RealPair',
          eig_indices: [0, 1],
          method: 'leaf_shooting_bvp',
          caps: {
            max_steps: 1024,
            max_points: 4096,
            max_rings: 128,
            max_vertices: 65536,
            max_time: 100
          }
        },
        manifold_geometry: {
          type: 'Surface',
          dim: 3,
          vertices_flat: [1, 0, 0, 0, 1, 0, -1, 0, 0, 2, 0, 0, 0, 2, 0, -2, 0, 0],
          triangles: [0, 1, 3, 1, 4, 3],
          ring_offsets: [0, 3, 6],
          ring_diagnostics: []
        }
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params]
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = updateNodeRender(branchResult.system, branchResult.nodeId, {
      manifoldSurfaceVisible: false
    })

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    expect(
      props?.data.some(
        (trace) =>
          'uid' in trace &&
          trace.uid === branchResult.nodeId &&
          trace.type === 'mesh3d'
      )
    ).toBe(false)
    expect(
      props?.data.some(
        (trace) =>
          'uid' in trace &&
          trace.uid === branchResult.nodeId &&
          trace.type === 'scatter3d' &&
          'mode' in trace &&
          trace.mode === 'lines'
      )
    ).toBe(true)
  })

  it('renders frozen 1D manifold curves as 3D traces in 3D scenes', () => {
    const config: SystemConfig = {
      name: 'Frozen_Manifold_1D_3D',
      equations: ['y', '-x + mu', '-z'],
      params: [0.3],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    const frozenZ = 2.5
    const subsystemSnapshot = buildSubsystemSnapshot(config, {
      frozenValuesByVarName: { z: frozenZ }
    })
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x', 'y', 'z']
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Frozen_Seed_1D',
      systemName: config.name,
      solution: {
        state: [0, 0, frozenZ],
        residual_norm: 0,
        iterations: 0,
        jacobian: [0, 1, 0, -1, 0, 0, 0, 0, -1],
        eigenpairs: []
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const continuationSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_manifold_frozen_curve',
      systemName: config.name,
      parameterName: 'manifold',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_1d',
      data: {
        points: [
          {
            state: [0.1, 0.4],
            param_value: 0,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [0.2, 0.5],
            param_value: 1,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [0.35, 0.7],
            param_value: 2,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1, 2],
        branch_type: {
          type: 'ManifoldEq1D',
          stability: 'Stable',
          direction: 'Plus',
          eig_index: 0,
          method: 'shooting_bvp',
          caps: {
            max_steps: 1024,
            max_points: 2048,
            max_rings: 64,
            max_vertices: 4096,
            max_time: 25
          }
        },
        manifold_geometry: {
          type: 'Curve',
          dim: 2,
          points_flat: [0.1, 0.4, 0.2, 0.5, 0.35, 0.7],
          arclength: [0, 1, 2],
          direction: 'Plus'
        }
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params],
      subsystemSnapshot
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = branchResult.system

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const manifoldTraces = (props?.data ?? []).filter(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'lines'
    )
    expect(manifoldTraces.some((trace) => trace.type === 'scatter3d')).toBe(
      true
    )
    expect(manifoldTraces.some((trace) => trace.type === 'scatter')).toBe(false)
    const manifoldTrace = manifoldTraces.find(
      (trace) => trace.type === 'scatter3d'
    ) as { z?: Array<number | null> } | undefined
    expect(manifoldTrace).toBeTruthy()
    const zValues = (manifoldTrace?.z ?? []).filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value)
    )
    expect(zValues.length).toBeGreaterThan(0)
    expect(zValues.every((value) => Math.abs(value - frozenZ) <= 1e-12)).toBe(
      true
    )
  })

  it('renders frozen 2D manifold surfaces as 3D mesh traces in 3D scenes', () => {
    const config: SystemConfig = {
      name: 'Frozen_Manifold_2D_3D',
      equations: ['y', '-x + mu', '-z'],
      params: [0.3],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    const frozenZ = -1.75
    const subsystemSnapshot = buildSubsystemSnapshot(config, {
      frozenValuesByVarName: { z: frozenZ }
    })
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x', 'y', 'z']
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Frozen_Seed_2D',
      systemName: config.name,
      solution: {
        state: [0, 0, frozenZ],
        residual_norm: 0,
        iterations: 0,
        jacobian: [0, 1, 0, -1, 0, 0, 0, 0, -1],
        eigenpairs: []
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const continuationSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_manifold_frozen_surface',
      systemName: config.name,
      parameterName: 'manifold',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_2d',
      data: {
        points: [
          { state: [1, 0], param_value: 0, stability: 'None', eigenvalues: [] },
          { state: [0, 1], param_value: 1, stability: 'None', eigenvalues: [] },
          {
            state: [-1, 0],
            param_value: 2,
            stability: 'None',
            eigenvalues: []
          },
          { state: [2, 0], param_value: 3, stability: 'None', eigenvalues: [] },
          { state: [0, 2], param_value: 4, stability: 'None', eigenvalues: [] },
          {
            state: [-2, 0],
            param_value: 5,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1, 2, 3, 4, 5],
        branch_type: {
          type: 'ManifoldEq2D',
          stability: 'Stable',
          eig_kind: 'RealPair',
          eig_indices: [0, 1],
          method: 'leaf_shooting_bvp',
          caps: {
            max_steps: 1024,
            max_points: 4096,
            max_rings: 128,
            max_vertices: 65536,
            max_time: 100
          }
        },
        manifold_geometry: {
          type: 'Surface',
          dim: 2,
          vertices_flat: [1, 0, 0, 1, -1, 0, 2, 0, 0, 2, -2, 0],
          triangles: [0, 1, 3, 1, 4, 3],
          ring_offsets: [0, 3, 6],
          ring_diagnostics: []
        }
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params],
      subsystemSnapshot
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = branchResult.system

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const manifoldLineTraces = (props?.data ?? []).filter(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'lines'
    )
    expect(manifoldLineTraces).toHaveLength(0)
    const meshTrace = (props?.data ?? []).find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        trace.type === 'mesh3d'
    ) as { z?: Array<number | null> } | undefined
    expect(meshTrace).toBeTruthy()
    const zValues = (meshTrace?.z ?? []).filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value)
    )
    expect(zValues.length).toBeGreaterThan(0)
    expect(zValues.every((value) => Math.abs(value - frozenZ) <= 1e-12)).toBe(
      true
    )
  })

  it('maps frozen manifold coordinates correctly when scene includes a frozen axis', () => {
    const config: SystemConfig = {
      name: 'Frozen_Manifold_Axis_Mapping',
      equations: ['y', '-x + mu', '-z'],
      params: [0.3],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    const frozenZ = 3.4
    const subsystemSnapshot = buildSubsystemSnapshot(config, {
      frozenValuesByVarName: { z: frozenZ }
    })
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x', 'z']
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Frozen_Seed_Axis',
      systemName: config.name,
      solution: {
        state: [0, 0, frozenZ],
        residual_norm: 0,
        iterations: 0,
        jacobian: [0, 1, 0, -1, 0, 0, 0, 0, -1],
        eigenpairs: []
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const continuationSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_manifold_frozen_axis_projection',
      systemName: config.name,
      parameterName: 'manifold',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_1d',
      data: {
        points: [
          {
            state: [1, 10],
            param_value: 0,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [2, 20],
            param_value: 1,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [3, 30],
            param_value: 2,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1, 2],
        branch_type: {
          type: 'ManifoldEq1D',
          stability: 'Stable',
          direction: 'Plus',
          eig_index: 0,
          method: 'shooting_bvp',
          caps: {
            max_steps: 1024,
            max_points: 2048,
            max_rings: 64,
            max_vertices: 4096,
            max_time: 25
          }
        },
        manifold_geometry: {
          type: 'Curve',
          dim: 2,
          points_flat: [1, 10, 2, 20, 3, 30],
          arclength: [0, 1, 2],
          direction: 'Plus'
        }
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params],
      subsystemSnapshot
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = branchResult.system

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const manifoldTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        trace.type === 'scatter' &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { x?: number[]; y?: number[] } | undefined
    expect(manifoldTrace).toBeTruthy()
    expect(manifoldTrace?.x).toEqual([1, 2, 3])
    expect(manifoldTrace?.y).toEqual([frozenZ, frozenZ, frozenZ])
  })

  it('renders frozen limit-cycle scene axes from embedded full-state values', () => {
    const config: SystemConfig = {
      name: 'Frozen_LC_Scene',
      equations: ['y', '-y', '0'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['y', 'z']
    })
    const seedOrbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit Seed',
      systemName: config.name,
      data: [
        [0, 0, 0, 0],
        [0.1, 0, 0, 0]
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
      parameters: [...config.params],
      frozenVariables: { frozenValuesByVarName: { x: 0, z: 2.2 } },
      subsystemSnapshot: buildSubsystemSnapshot(config, {
        frozenValuesByVarName: { x: 0, z: 2.2 }
      })
    }
    const orbitResult = addObject(system, seedOrbit)
    system = orbitResult.system
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_frozen_branch',
      systemName: config.name,
      parameterName: 'var:x',
      parameterRef: { kind: 'frozen_var', variableName: 'x' },
      parentObject: seedOrbit.name,
      startObject: seedOrbit.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [1.5, 1.8, 9],
            param_value: 0.3,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [2.5, 2.9, 9],
            param_value: 0.5,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: { type: 'LimitCycle', ntst: 1, ncol: 1 }
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 10,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6
      },
      timestamp: nowIso(),
      params: [...config.params],
      subsystemSnapshot: seedOrbit.subsystemSnapshot
    }
    const branchResult = addBranch(system, branch, orbitResult.nodeId)
    system = branchResult.system

    renderPanel(system, {
      branchPointSelection: { branchId: branchResult.nodeId, pointIndex: 1 }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const lcLines = (props?.data ?? []).filter(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as Array<{
      x?: Array<number | null>
      y?: Array<number | null>
      text?: string[]
      hovertemplate?: string
    }>
    expect(lcLines.length).toBeGreaterThan(0)
    const lineWithParamText = lcLines.find(
      (line) =>
        Array.isArray(line.text) &&
        line.text.some(
          (entry) => typeof entry === 'string' && entry.includes('x:')
        )
    )
    expect(lineWithParamText).toBeTruthy()
    expect(lineWithParamText?.hovertemplate).toContain('%{text}')
    for (const line of lcLines) {
      const numericY = (line.y ?? []).filter(
        (value): value is number => typeof value === 'number'
      )
      expect(numericY.length).toBeGreaterThan(0)
      for (const yValue of numericY) {
        expect(yValue).toBeCloseTo(2.2)
      }
    }
  })

  it('renders one-free-variable cycle branches as envelopes in 3D scenes', () => {
    const config: SystemConfig = {
      name: 'Frozen_LC_Scene_Envelope_3D',
      equations: ['y', '0', '0'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['x', 'y', 'z']
    })
    const seedOrbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit Seed',
      systemName: config.name,
      data: [
        [0, 0, 0, 0],
        [0.1, 0, 0, 0]
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
      parameters: [...config.params],
      frozenVariables: { frozenValuesByVarName: { x: 1.5, y: 0.2 } },
      subsystemSnapshot: buildSubsystemSnapshot(config, {
        frozenValuesByVarName: { x: 1.5, y: 0.2 }
      })
    }
    const orbitResult = addObject(system, seedOrbit)
    system = orbitResult.system
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_frozen_scene_envelope',
      systemName: config.name,
      parameterName: 'var:y',
      parameterRef: { kind: 'frozen_var', variableName: 'y' },
      parentObject: seedOrbit.name,
      startObject: seedOrbit.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [2, 4, 9],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [3, 5, 9],
            param_value: 0.6,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: { type: 'LimitCycle', ntst: 1, ncol: 1 }
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 10,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6
      },
      timestamp: nowIso(),
      params: [...config.params],
      subsystemSnapshot: seedOrbit.subsystemSnapshot
    }
    const branchResult = addBranch(system, branch, orbitResult.nodeId)
    system = branchResult.system

    renderPanel(system, {
      branchPointSelection: { branchId: branchResult.nodeId, pointIndex: 1 }
    })

    const props = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(props).toBeTruthy()
    const maxTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'type' in trace &&
        trace.type === 'scatter3d' &&
        'mode' in trace &&
        trace.mode === 'lines' &&
        'name' in trace &&
        trace.name === branch.name
    ) as { x?: number[]; y?: number[]; z?: number[] } | undefined
    const minTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'type' in trace &&
        trace.type === 'scatter3d' &&
        'mode' in trace &&
        trace.mode === 'lines' &&
        'name' in trace &&
        trace.name === `${branch.name} min`
    ) as { x?: number[]; y?: number[]; z?: number[] } | undefined

    expect(maxTrace?.x).toEqual([1.5, 1.5])
    expect(minTrace?.x).toEqual([1.5, 1.5])
    expect(maxTrace?.y).toEqual([0.2, 0.6])
    expect(minTrace?.y).toEqual([0.2, 0.6])
    expect(maxTrace?.z).toEqual([4, 5])
    expect(minTrace?.z).toEqual([2, 3])

    const selectedTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'type' in trace &&
        trace.type === 'scatter3d' &&
        'name' in trace &&
        trace.name === `${branch.name} selected point` &&
        'mode' in trace &&
        trace.mode === 'markers'
    ) as
      | {
          x?: number[]
          y?: number[]
          z?: number[]
          customdata?: number[]
          marker?: { symbol?: string }
        }
      | undefined
    expect(selectedTrace?.x).toEqual([1.5, 1.5])
    expect(selectedTrace?.y).toEqual([0.6, 0.6])
    expect(selectedTrace?.z).toEqual([5, 3])
    expect(selectedTrace?.customdata).toEqual([1, 1])
    expect(selectedTrace?.marker?.symbol).toBe('circle-open')
  })

  it('renders one-free-variable limit-cycle diagram branches as envelopes with axis flips', () => {
    const config: SystemConfig = {
      name: 'Frozen_LC_Diagram_Envelope',
      equations: ['0', 'x - y'],
      params: [0.3],
      paramNames: ['mu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const seedOrbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit Seed',
      systemName: config.name,
      data: [
        [0, 0, 0],
        [0.1, 0, 0]
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
      parameters: [...config.params],
      frozenVariables: { frozenValuesByVarName: { x: 0.2 } },
      subsystemSnapshot: buildSubsystemSnapshot(config, {
        frozenValuesByVarName: { x: 0.2 }
      })
    }
    const orbitResult = addObject(system, seedOrbit)
    system = orbitResult.system
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_frozen_diagram_envelope',
      systemName: config.name,
      parameterName: 'var:x',
      parameterRef: { kind: 'frozen_var', variableName: 'x' },
      parentObject: seedOrbit.name,
      startObject: seedOrbit.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [1, 3, 9],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [2, 5, 9],
            param_value: 0.6,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: { type: 'LimitCycle', ntst: 1, ncol: 1 }
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 10,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6
      },
      timestamp: nowIso(),
      params: [...config.params],
      subsystemSnapshot: seedOrbit.subsystemSnapshot
    }
    const branchResult = addBranch(system, branch, orbitResult.nodeId)
    system = branchResult.system
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(
      diagramResult.system,
      diagramResult.nodeId,
      {
        xAxis: { kind: 'state', name: 'x' },
        yAxis: { kind: 'state', name: 'y' }
      }
    )

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === diagramResult.nodeId
    )
    expect(props).toBeTruthy()
    const maxTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'name' in trace &&
        trace.name === branch.name &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { x?: number[]; y?: number[] } | undefined
    const minTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'name' in trace &&
        trace.name === `${branch.name} min` &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { x?: number[]; y?: number[] } | undefined

    expect(maxTrace?.x).toEqual([0.2, 0.6])
    expect(maxTrace?.y).toEqual([3, 5])
    expect(minTrace?.x).toEqual([0.2, 0.6])
    expect(minTrace?.y).toEqual([1, 2])

    plotlyCalls.length = 0
    system = updateBifurcationDiagram(system, diagramResult.nodeId, {
      xAxis: { kind: 'state', name: 'y' },
      yAxis: { kind: 'state', name: 'x' }
    })
    renderPanel(system)

    const flippedProps = plotlyCalls.find(
      (entry) => entry.plotId === diagramResult.nodeId
    )
    expect(flippedProps).toBeTruthy()
    const flippedMaxTrace = flippedProps?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'name' in trace &&
        trace.name === branch.name &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { x?: number[]; y?: number[] } | undefined
    const flippedMinTrace = flippedProps?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'name' in trace &&
        trace.name === `${branch.name} min` &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { x?: number[]; y?: number[] } | undefined

    expect(flippedMaxTrace?.x).toEqual([3, 5])
    expect(flippedMaxTrace?.y).toEqual([0.2, 0.6])
    expect(flippedMinTrace?.x).toEqual([1, 2])
    expect(flippedMinTrace?.y).toEqual([0.2, 0.6])
  })

  it('renders envelopes when plotted state axes include one free variable even with multi-free subsystems', () => {
    const config: SystemConfig = {
      name: 'Frozen_LC_MultiFree_Axes_Envelope',
      equations: ['0', '0', 'c', 'd'],
      params: [0.1],
      paramNames: ['mu'],
      varNames: ['a', 'b', 'c', 'd'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const sceneResult = addScene(system, 'Scene 1')
    system = updateScene(sceneResult.system, sceneResult.nodeId, {
      axisVariables: ['a', 'b', 'c']
    })
    const seedOrbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit Seed',
      systemName: config.name,
      data: [
        [0, 0, 0, 0, 0],
        [0.1, 0, 0, 0, 0]
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
      parameters: [...config.params],
      frozenVariables: { frozenValuesByVarName: { a: 1.5, b: 0.2 } },
      subsystemSnapshot: buildSubsystemSnapshot(config, {
        frozenValuesByVarName: { a: 1.5, b: 0.2 }
      })
    }
    const orbitResult = addObject(system, seedOrbit)
    system = orbitResult.system
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_frozen_multifree_envelope',
      systemName: config.name,
      parameterName: 'var:b',
      parameterRef: { kind: 'frozen_var', variableName: 'b' },
      parentObject: seedOrbit.name,
      startObject: seedOrbit.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [10, 100, 20, 200, 15, 150, 9],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [30, 300, 40, 400, 35, 350, 9],
            param_value: 0.6,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: { type: 'LimitCycle', ntst: 1, ncol: 1 }
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 10,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6
      },
      timestamp: nowIso(),
      params: [...config.params],
      subsystemSnapshot: seedOrbit.subsystemSnapshot
    }
    const branchResult = addBranch(system, branch, orbitResult.nodeId)
    system = branchResult.system

    renderPanel(system)

    const sceneProps = plotlyCalls.find(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    expect(sceneProps).toBeTruthy()
    const sceneMaxTrace = sceneProps?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'type' in trace &&
        trace.type === 'scatter3d' &&
        'mode' in trace &&
        trace.mode === 'lines' &&
        'name' in trace &&
        trace.name === branch.name
    ) as { x?: number[]; y?: number[]; z?: number[] } | undefined
    const sceneMinTrace = sceneProps?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'type' in trace &&
        trace.type === 'scatter3d' &&
        'mode' in trace &&
        trace.mode === 'lines' &&
        'name' in trace &&
        trace.name === `${branch.name} min`
    ) as { x?: number[]; y?: number[]; z?: number[] } | undefined

    expect(sceneMaxTrace?.x).toEqual([1.5, 1.5])
    expect(sceneMinTrace?.x).toEqual([1.5, 1.5])
    expect(sceneMaxTrace?.y).toEqual([0.2, 0.6])
    expect(sceneMinTrace?.y).toEqual([0.2, 0.6])
    expect(sceneMaxTrace?.z).toEqual([20, 40])
    expect(sceneMinTrace?.z).toEqual([10, 30])

    plotlyCalls.length = 0
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(
      diagramResult.system,
      diagramResult.nodeId,
      {
        xAxis: { kind: 'state', name: 'b' },
        yAxis: { kind: 'state', name: 'c' }
      }
    )
    renderPanel(system)

    const diagramProps = plotlyCalls.find(
      (entry) => entry.plotId === diagramResult.nodeId
    )
    expect(diagramProps).toBeTruthy()
    const diagramMaxTrace = diagramProps?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'name' in trace &&
        trace.name === branch.name &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { x?: number[]; y?: number[] } | undefined
    const diagramMinTrace = diagramProps?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === branchResult.nodeId &&
        'name' in trace &&
        trace.name === `${branch.name} min` &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as { x?: number[]; y?: number[] } | undefined

    expect(diagramMaxTrace?.x).toEqual([0.2, 0.6])
    expect(diagramMinTrace?.x).toEqual([0.2, 0.6])
    expect(diagramMaxTrace?.y).toEqual([20, 40])
    expect(diagramMinTrace?.y).toEqual([10, 30])
  })

  it('renders full limit cycles on state-variable bifurcation diagrams for flows', () => {
    const config: SystemConfig = {
      name: 'LimitCycle_Diagram',
      equations: ['x', 'y'],
      params: [0.4],
      paramNames: ['mu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    const defaultSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-5,
      max_step_size: 0.1,
      max_steps: 100,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    let system = createSystem({ name: 'LimitCycle_Diagram', config })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit A',
      systemName: config.name,
      data: [
        [0, 0.1, 0.2],
        [0.1, 0.2, 0.3]
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
      parameters: [...config.params]
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_branch',
      systemName: config.name,
      parameterName: 'mu',
      parentObject: orbit.name,
      startObject: orbit.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0, 0, 1, 0, 0, 1, 2],
            param_value: 0.4,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [0, 0, 1, 1, 0, 1, 2],
            param_value: 0.6,
            stability: 'PeriodDoubling',
            eigenvalues: []
          }
        ],
        bifurcations: [1],
        indices: [0, 1],
        branch_type: { type: 'LimitCycle', ntst: 2, ncol: 1 }
      },
      settings: defaultSettings,
      timestamp: nowIso(),
      params: [...config.params]
    }
    const branchResult = addBranch(system, branch, orbitResult.nodeId)
    system = branchResult.system
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(
      diagramResult.system,
      diagramResult.nodeId,
      {
        xAxis: { kind: 'state', name: 'x' },
        yAxis: { kind: 'state', name: 'y' }
      }
    )

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === diagramResult.nodeId
    )
    expect(props).toBeTruthy()
    const mainTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === branch.name &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as
      | {
          x?: Array<number | null>
          customdata?: Array<number | null>
        }
      | undefined
    expect(mainTrace).toBeTruthy()
    const numericX = (mainTrace?.x ?? []).filter(
      (value) => typeof value === 'number'
    ) as number[]
    expect(numericX.length).toBe(6)
    const numericCustomdata = (mainTrace?.customdata ?? []).filter(
      (value) => typeof value === 'number'
    ) as number[]
    expect(numericCustomdata.filter((value) => value === 0).length).toBe(3)
    expect(numericCustomdata.filter((value) => value === 1).length).toBe(3)

    const bifTrace = props?.data.find(
      (trace) => 'name' in trace && trace.name === `${branch.name} bifurcations`
    ) as
      | {
          x?: number[]
          marker?: { symbol?: string }
          text?: string[]
        }
      | undefined
    expect(bifTrace).toBeTruthy()
    expect(bifTrace?.marker?.symbol).toBe('diamond')
    const bifX = (bifTrace?.x ?? []).filter(
      (value) => typeof value === 'number'
    ) as number[]
    expect(bifX.length).toBe(3)
    expect(bifTrace?.text?.[0]).toContain('Index 1')
    expect(bifTrace?.text?.[0]).toContain('Period Doubling')
  })

  it('renders homoclinic branches on flow state-variable bifurcation diagrams', () => {
    const config: SystemConfig = {
      name: 'Flow_Homoc_Diagram',
      equations: ['y', '-x'],
      params: [0.2, 0.1],
      paramNames: ['mu', 'nu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed',
      systemName: config.name,
      solution: {
        state: [0, 0],
        residual_norm: 0,
        iterations: 0,
        jacobian: [0, 0, 0, 0],
        eigenpairs: []
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const continuationSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-6,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_branch',
      systemName: config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: [
              // mesh + stage
              0, 0, 1, 0, 2, 0, 0.5, 0, 1.5, 0,
              // x0 + p2 + extras/tail
              0.1, 0.2, 0.1, 8, 0.02, 0, 0
            ],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: []
          },
          {
            state: [
              // mesh + stage
              1, 1, 2, 1, 3, 1, 1.5, 1, 2.5, 1,
              // x0 + p2 + extras/tail
              0.4, 0.5, 0.12, 9, 0.02, 0, 0
            ],
            param_value: 0.3,
            stability: 'None',
            eigenvalues: []
          }
        ],
        bifurcations: [1],
        indices: [0, 1],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 2,
          ncol: 1,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: true,
          free_eps0: true,
          free_eps1: false
        }
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params]
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = branchResult.system
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(
      diagramResult.system,
      diagramResult.nodeId,
      {
        xAxis: { kind: 'state', name: 'x' },
        yAxis: { kind: 'state', name: 'y' }
      }
    )

    renderPanel(system)

    const props = plotlyCalls.find(
      (entry) => entry.plotId === diagramResult.nodeId
    )
    expect(props).toBeTruthy()
    const mainTrace = props?.data.find(
      (trace) =>
        'name' in trace &&
        trace.name === branch.name &&
        'mode' in trace &&
        trace.mode === 'lines'
    ) as
      | {
          x?: Array<number | null>
          y?: Array<number | null>
        }
      | undefined
    expect(mainTrace).toBeTruthy()
    const numericX = (mainTrace?.x ?? []).filter(
      (value) => typeof value === 'number'
    ) as number[]
    const numericY = (mainTrace?.y ?? []).filter(
      (value) => typeof value === 'number'
    ) as number[]
    expect(numericX.length).toBeGreaterThan(0)
    expect(numericY.length).toBeGreaterThan(0)
  })

  it('expands 1D map sampling range to include cycle points', async () => {
    const config: SystemConfig = {
      name: 'Logistic_Map',
      equations: ['r * x * (1 - x)'],
      params: [2.5],
      paramNames: ['r'],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map'
    }
    let system = createSystem({ name: 'Map_System', config })
    system = addScene(system, 'Scene 1').system
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Cycle_FP',
      systemName: config.name,
      solution: {
        state: [0.3],
        residual_norm: 0,
        iterations: 0,
        jacobian: [1],
        eigenpairs: [],
        cycle_points: [[0.3], [0.9]]
      }
    }
    system = addObject(system, equilibrium).system
    const onSampleMap1DFunction = vi.fn().mockResolvedValue({ x: [], y: [] })

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
        onSampleMap1DFunction={onSampleMap1DFunction}
      />
    )

    await waitFor(() => expect(onSampleMap1DFunction).toHaveBeenCalled())
    const [request] = onSampleMap1DFunction.mock.calls[0]
    expect(request.min).toBeCloseTo(0.3)
    expect(request.max).toBeCloseTo(0.9)
  })

  it('retries map sampling after a failed request when range stays the same', async () => {
    const config: SystemConfig = {
      name: 'Logistic_Map',
      equations: ['r * x * (1 - x)'],
      params: [2.5],
      paramNames: ['r'],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map'
    }
    let system = createSystem({ name: 'Map_System', config })
    system = addScene(system, 'Scene 1').system
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Cycle_FP',
      systemName: config.name,
      solution: {
        state: [0.3],
        residual_norm: 0,
        iterations: 0,
        jacobian: [1],
        eigenpairs: [],
        cycle_points: [[0.3]]
      }
    }
    system = addObject(system, equilibrium).system
    const onSampleMap1DFunction = vi
      .fn()
      .mockRejectedValueOnce(new Error('sample failed'))
      .mockResolvedValueOnce({ x: [], y: [] })

    const { rerender } = render(
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
        onSampleMap1DFunction={onSampleMap1DFunction}
      />
    )

    await waitFor(() => expect(onSampleMap1DFunction).toHaveBeenCalledTimes(1))
    const firstPromise = onSampleMap1DFunction.mock.results[0]?.value
    if (firstPromise) {
      await firstPromise.catch(() => {})
    }

    rerender(
      <ViewportPanel
        system={structuredClone(system)}
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
        onSampleMap1DFunction={onSampleMap1DFunction}
      />
    )

    await waitFor(() => expect(onSampleMap1DFunction).toHaveBeenCalledTimes(2))
  })

  it('renders cobwebs for 1D map cycles with period > 1', () => {
    const config: SystemConfig = {
      name: 'Logistic_Map',
      equations: ['r * x * (1 - x)'],
      params: [2.5],
      paramNames: ['r'],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map'
    }
    let system = createSystem({ name: 'Map_System', config })
    const sceneResult = addScene(system, 'Scene 1')
    system = sceneResult.system
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Cycle_FP',
      systemName: config.name,
      solution: {
        state: [0.3],
        residual_norm: 0,
        iterations: 0,
        jacobian: [1],
        eigenpairs: [],
        cycle_points: [[0.3], [0.9]]
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system

    renderPanel(system)

    const sceneCalls = plotlyCalls.filter(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    const props = sceneCalls[sceneCalls.length - 1]
    expect(props).toBeTruthy()
    const cobwebTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === equilibriumResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'lines' &&
        'name' in trace &&
        trace.name === equilibrium.name
    ) as { x?: number[]; y?: number[] } | undefined
    expect(cobwebTrace).toBeTruthy()
    if (
      !cobwebTrace ||
      !Array.isArray(cobwebTrace.x) ||
      !Array.isArray(cobwebTrace.y)
    ) {
      throw new Error('Expected cobweb trace coordinates.')
    }
    const lastIndex = cobwebTrace.x.length - 1
    expect(lastIndex).toBeGreaterThanOrEqual(0)
    expect(Number(cobwebTrace.x[lastIndex])).toBeCloseTo(0.3)
    expect(Number(cobwebTrace.y[lastIndex])).toBeCloseTo(0.3)
  })

  it('does not render cobwebs for single-point map cycles', () => {
    const config: SystemConfig = {
      name: 'Logistic_Map',
      equations: ['r * x * (1 - x)'],
      params: [2.5],
      paramNames: ['r'],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map'
    }
    let system = createSystem({ name: 'Map_System', config })
    const sceneResult = addScene(system, 'Scene 1')
    system = sceneResult.system
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'FixedPoint',
      systemName: config.name,
      solution: {
        state: [0.3],
        residual_norm: 0,
        iterations: 0,
        jacobian: [1],
        eigenpairs: [],
        cycle_points: [[0.3]]
      }
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system

    renderPanel(system)

    const sceneCalls = plotlyCalls.filter(
      (entry) => entry.plotId === sceneResult.nodeId
    )
    const props = sceneCalls[sceneCalls.length - 1]
    expect(props).toBeTruthy()
    const cobwebTrace = props?.data.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === equilibriumResult.nodeId &&
        'mode' in trace &&
        trace.mode === 'lines' &&
        'name' in trace &&
        trace.name === equilibrium.name
    )
    expect(cobwebTrace).toBeFalsy()
  })

  it('updates event map traces when source render styles change', async () => {
    const config: SystemConfig = {
      name: 'Analysis_Render_System',
      equations: ['y', '-x'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: 'Analysis_Render_System', config })
    const analysisResult = addAnalysisViewport(system, 'Event_Map_1')
    system = analysisResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Render_Target',
      systemName: config.name,
      data: [
        [0, 0, 1],
        [0.1, 1, 0]
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system
    system = updateAnalysisViewport(system, analysisResult.nodeId, {
      sourceNodeIds: [orbitResult.nodeId],
      event: {
        mode: 'cross_up',
        source: { kind: 'custom', expression: 'x' },
        level: 0
      },
      axes: {
        x: { kind: 'observable', expression: 'x', hitOffset: 0, label: 'x@n' },
        y: { kind: 'hit_index', label: 'n' },
        z: null
      }
    })
    system = updateNodeRender(system, orbitResult.nodeId, {
      pointSize: 5,
      lineWidth: 2
    })
    const onComputeEventSeriesFromSamples = vi.fn().mockResolvedValue({
      hits: [
        {
          order: 0,
          sample_index: 1,
          time: 0.1,
          state: [1, 0],
          observable_values: [1]
        }
      ]
    })

    function Wrapper() {
      const [state, setState] = useState(system)
      return (
        <>
          <ViewportPanel
            system={state}
            selectedNodeId={null}
            theme="light"
            onSelectViewport={vi.fn()}
            onSelectObject={vi.fn()}
            onReorderViewport={vi.fn()}
            onResizeViewport={vi.fn()}
            onToggleViewport={vi.fn()}
            onCreateScene={vi.fn()}
            onCreateAnalysis={vi.fn()}
            onCreateBifurcation={vi.fn()}
            onRenameViewport={vi.fn()}
            onDeleteViewport={vi.fn()}
            onComputeEventSeriesFromSamples={onComputeEventSeriesFromSamples}
          />
          <button
            data-testid="update-analysis-render"
            onClick={() => {
              setState((prev) =>
                updateNodeRender(prev, orbitResult.nodeId, {
                  pointSize: 11,
                  lineWidth: 7
                })
              )
            }}
          >
            Update render
          </button>
        </>
      )
    }

    render(<Wrapper />)

    const latestCallFor = () => {
      const calls = plotlyCalls.filter(
        (entry) =>
          entry.plotId === analysisResult.nodeId && entry.data.length > 0
      )
      return calls[calls.length - 1]
    }

    await waitFor(() => {
      const props = latestCallFor()
      expect(props).toBeTruthy()
      const trace = props?.data[0] as
        | { marker?: { size?: number }; line?: { width?: number } }
        | undefined
      expect(trace?.marker?.size).toBe(5)
      expect(trace?.line?.width).toBe(2)
    })

    fireEvent.click(screen.getByTestId('update-analysis-render'))

    await waitFor(() => {
      const props = latestCallFor()
      const trace = props?.data[0] as
        | { marker?: { size?: number }; line?: { width?: number } }
        | undefined
      expect(trace?.marker?.size).toBe(11)
      expect(trace?.line?.width).toBe(7)
    })
  })

  it('renders identity lines for same-observable event maps even when cobwebs are off', async () => {
    const config: SystemConfig = {
      name: 'Analysis_Identity_Line_System',
      equations: ['x'],
      params: [],
      paramNames: [],
      varNames: ['x'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({
      name: 'Analysis_Identity_Line_System',
      config
    })
    const analysisResult = addAnalysisViewport(system, 'Event_Map_1')
    system = analysisResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Identity_Line_Target',
      systemName: config.name,
      data: [
        [0, -1],
        [0.1, 0.5],
        [0.2, 1.5]
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system
    system = updateAnalysisViewport(system, analysisResult.nodeId, {
      sourceNodeIds: [orbitResult.nodeId],
      event: {
        mode: 'cross_up',
        source: { kind: 'custom', expression: 'x' },
        level: 0,
        positivityConstraints: []
      },
      axes: {
        x: { kind: 'observable', expression: 'x', hitOffset: 0, label: 'x@n' },
        y: {
          kind: 'observable',
          expression: 'x',
          hitOffset: 1,
          label: 'x@n+1'
        },
        z: null
      },
      advanced: {
        skipHits: 0,
        hitStride: 1,
        maxHits: 2000,
        connectPoints: false,
        showIdentityLine: true,
        identityLineColor: '#112233',
        identityLineStyle: 'dashed'
      }
    })
    const onComputeEventSeriesFromSamples = vi.fn().mockResolvedValue({
      hits: [
        {
          order: 0,
          sample_index: 0,
          time: 0,
          state: [1],
          observable_values: [1]
        },
        {
          order: 1,
          sample_index: 1,
          time: 0.1,
          state: [2],
          observable_values: [2]
        },
        {
          order: 2,
          sample_index: 2,
          time: 0.2,
          state: [4],
          observable_values: [4]
        }
      ]
    })

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
        onCreateAnalysis={vi.fn()}
        onCreateBifurcation={vi.fn()}
        onRenameViewport={vi.fn()}
        onDeleteViewport={vi.fn()}
        onComputeEventSeriesFromSamples={onComputeEventSeriesFromSamples}
      />
    )

    await waitFor(() => {
      const props = plotlyCalls
        .filter(
          (entry) =>
            entry.plotId === analysisResult.nodeId && entry.data.length > 0
        )
        .at(-1)
      expect(props).toBeTruthy()

      const identityTrace = props?.data.find(
        (trace) =>
          'name' in trace &&
          trace.name === 'Identity line' &&
          'line' in trace &&
          typeof trace.line === 'object'
      ) as
        | {
            x?: number[]
            y?: number[]
            line?: { color?: string; dash?: string }
          }
        | undefined
      const markerTrace = props?.data.find(
        (trace) =>
          'uid' in trace &&
          trace.uid === orbitResult.nodeId &&
          'mode' in trace &&
          trace.mode === 'markers'
      ) as { x?: number[]; y?: number[] } | undefined

      expect(identityTrace?.x).toEqual([1, 4])
      expect(identityTrace?.y).toEqual([1, 4])
      expect(identityTrace?.line?.color).toBe('#112233')
      expect(identityTrace?.line?.dash).toBe('dash')
      expect(markerTrace?.x).toEqual([1, 2])
      expect(markerTrace?.y).toEqual([2, 4])
      expect(
        props?.data.some(
          (trace) =>
            'name' in trace &&
            typeof trace.name === 'string' &&
            trace.name.includes('cobweb')
        )
      ).toBe(false)
    })
  })

  it('draws cobweb legs in hit-offset order for reversed same-observable event maps', async () => {
    const config: SystemConfig = {
      name: 'Analysis_Reversed_Cobweb_System',
      equations: ['x'],
      params: [],
      paramNames: [],
      varNames: ['x'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({
      name: 'Analysis_Reversed_Cobweb_System',
      config
    })
    const analysisResult = addAnalysisViewport(system, 'Event_Map_1')
    system = analysisResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Reversed_Cobweb_Target',
      systemName: config.name,
      data: [
        [0, -1],
        [0.1, 0.5],
        [0.2, 1.5]
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system
    system = updateAnalysisViewport(system, analysisResult.nodeId, {
      sourceNodeIds: [orbitResult.nodeId],
      event: {
        mode: 'cross_up',
        source: { kind: 'custom', expression: 'x' },
        level: 0,
        positivityConstraints: []
      },
      axes: {
        x: {
          kind: 'observable',
          expression: 'x',
          hitOffset: 1,
          label: 'x@n+1'
        },
        y: { kind: 'observable', expression: 'x', hitOffset: 0, label: 'x@n' },
        z: null
      },
      advanced: {
        skipHits: 0,
        hitStride: 1,
        maxHits: 2000,
        connectPoints: true,
        showIdentityLine: false,
        identityLineColor: '#787878',
        identityLineStyle: 'dotted'
      }
    })
    const onComputeEventSeriesFromSamples = vi.fn().mockResolvedValue({
      hits: [
        {
          order: 0,
          sample_index: 0,
          time: 0,
          state: [2],
          observable_values: [2]
        },
        {
          order: 1,
          sample_index: 1,
          time: 0.1,
          state: [3],
          observable_values: [3]
        },
        {
          order: 2,
          sample_index: 2,
          time: 0.2,
          state: [5],
          observable_values: [5]
        }
      ]
    })

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
        onCreateAnalysis={vi.fn()}
        onCreateBifurcation={vi.fn()}
        onRenameViewport={vi.fn()}
        onDeleteViewport={vi.fn()}
        onComputeEventSeriesFromSamples={onComputeEventSeriesFromSamples}
      />
    )

    await waitFor(() => {
      const props = plotlyCalls
        .filter(
          (entry) =>
            entry.plotId === analysisResult.nodeId && entry.data.length > 0
        )
        .at(-1)
      expect(props).toBeTruthy()

      const cobwebTrace = props?.data.find(
        (trace) =>
          'name' in trace &&
          trace.name === 'Orbit_Reversed_Cobweb_Target cobweb' &&
          'mode' in trace &&
          trace.mode === 'lines'
      ) as { x?: Array<number | null>; y?: Array<number | null> } | undefined
      const markerTrace = props?.data.find(
        (trace) =>
          'uid' in trace &&
          trace.uid === orbitResult.nodeId &&
          'mode' in trace &&
          trace.mode === 'markers'
      ) as { x?: number[]; y?: number[] } | undefined

      expect(cobwebTrace?.x).toEqual([2, 3, 3, null, 3, 5, 5, null])
      expect(cobwebTrace?.y).toEqual([2, 2, 3, null, 3, 3, 5, null])
      expect(markerTrace?.x).toEqual([3, 5])
      expect(markerTrace?.y).toEqual([2, 3])
      expect(
        props?.data.some(
          (trace) => 'name' in trace && trace.name === 'Identity line'
        )
      ).toBe(false)
    })
  })

  it('renders cobweb and identity-line overlays for delta-t event maps with different hit offsets', async () => {
    const config: SystemConfig = {
      name: 'Analysis_Delta_T_Cobweb_System',
      equations: ['x'],
      params: [],
      paramNames: [],
      varNames: ['x'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: 'Analysis_Delta_T_Cobweb_System', config })
    const analysisResult = addAnalysisViewport(system, 'Event_Map_1')
    system = analysisResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Delta_T_Target',
      systemName: config.name,
      data: [
        [0, 0],
        [0.1, 1],
        [0.4, 2],
        [0.9, 3]
      ],
      t_start: 0,
      t_end: 0.9,
      dt: 0.1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system
    system = updateAnalysisViewport(system, analysisResult.nodeId, {
      sourceNodeIds: [orbitResult.nodeId],
      event: {
        mode: 'cross_up',
        source: { kind: 'custom', expression: 'x' },
        level: 0,
        positivityConstraints: []
      },
      axes: {
        x: { kind: 'delta_time', hitOffset: 0, label: 'Delta t@n' },
        y: { kind: 'delta_time', hitOffset: 1, label: 'Delta t@n+1' },
        z: null
      },
      advanced: {
        skipHits: 0,
        hitStride: 1,
        maxHits: 2000,
        connectPoints: true,
        showIdentityLine: true,
        identityLineColor: '#224466',
        identityLineStyle: 'dotted'
      }
    })
    const onComputeEventSeriesFromSamples = vi.fn().mockResolvedValue({
      hits: [
        {
          order: 0,
          sample_index: 0,
          time: 0,
          state: [0],
          observable_values: [0]
        },
        {
          order: 1,
          sample_index: 1,
          time: 0.25,
          state: [1],
          observable_values: [1]
        },
        {
          order: 2,
          sample_index: 2,
          time: 0.75,
          state: [2],
          observable_values: [2]
        },
        {
          order: 3,
          sample_index: 3,
          time: 1.5,
          state: [3],
          observable_values: [3]
        }
      ]
    })

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
        onCreateAnalysis={vi.fn()}
        onCreateBifurcation={vi.fn()}
        onRenameViewport={vi.fn()}
        onDeleteViewport={vi.fn()}
        onComputeEventSeriesFromSamples={onComputeEventSeriesFromSamples}
      />
    )

    await waitFor(() => {
      const props = plotlyCalls
        .filter(
          (entry) =>
            entry.plotId === analysisResult.nodeId && entry.data.length > 0
        )
        .at(-1)
      expect(props).toBeTruthy()

      const identityTrace = props?.data.find(
        (trace) => 'name' in trace && trace.name === 'Identity line'
      ) as { x?: number[]; y?: number[]; line?: { color?: string; dash?: string } } | undefined
      const cobwebTrace = props?.data.find(
        (trace) =>
          'name' in trace &&
          trace.name === 'Orbit_Delta_T_Target cobweb' &&
          'mode' in trace &&
          trace.mode === 'lines'
      ) as { x?: Array<number | null>; y?: Array<number | null> } | undefined
      const markerTrace = props?.data.find(
        (trace) =>
          'uid' in trace &&
          trace.uid === orbitResult.nodeId &&
          'mode' in trace &&
          trace.mode === 'markers'
      ) as { x?: number[]; y?: number[] } | undefined

      expect(identityTrace?.x).toEqual([0.25, 0.75])
      expect(identityTrace?.y).toEqual([0.25, 0.75])
      expect(identityTrace?.line?.color).toBe('#224466')
      expect(identityTrace?.line?.dash).toBe('dot')
      expect(markerTrace?.x).toEqual([0.25, 0.5])
      expect(markerTrace?.y).toEqual([0.5, 0.75])
      expect(cobwebTrace?.x).toEqual([0.25, 0.25, 0.5, null, 0.5, 0.5, 0.75, null])
      expect(cobwebTrace?.y).toEqual([0.25, 0.5, 0.5, null, 0.5, 0.75, 0.75, null])
    })
  })

  it('selects orbit hits from event map clicks using hit-offset-0 metadata', async () => {
    const config: SystemConfig = {
      name: 'Analysis_Click_System',
      equations: ['y', '-x'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: 'Analysis_Click_System', config })
    const analysisResult = addAnalysisViewport(system, 'Event_Map_1')
    system = analysisResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Click_Target',
      systemName: config.name,
      data: [
        [0, 0, 1],
        [0.1, 1, 0],
        [0.2, 2, -1]
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system
    system = updateAnalysisViewport(system, analysisResult.nodeId, {
      sourceNodeIds: [orbitResult.nodeId],
      event: {
        mode: 'cross_up',
        source: { kind: 'custom', expression: 'x' },
        level: 0,
        positivityConstraints: []
      },
      axes: {
        x: {
          kind: 'observable',
          expression: 'x',
          hitOffset: 1,
          label: 'x@n+1'
        },
        y: { kind: 'observable', expression: 'x', hitOffset: 0, label: 'x@n' },
        z: null
      }
    })
    const onSelectObject = vi.fn()
    const onSelectOrbitPoint = vi.fn()
    const onComputeEventSeriesFromSamples = vi.fn().mockResolvedValue({
      hits: [
        {
          order: 2,
          sample_index: 1,
          time: 0.125,
          state: [0.5, 0.25],
          observable_values: [1.5]
        },
        {
          order: 3,
          sample_index: 2,
          time: 0.2,
          state: [2, -1],
          observable_values: [2]
        }
      ]
    })

    render(
      <ViewportPanel
        system={system}
        selectedNodeId={null}
        theme="light"
        onSelectViewport={vi.fn()}
        onSelectObject={onSelectObject}
        onSelectOrbitPoint={onSelectOrbitPoint}
        onReorderViewport={vi.fn()}
        onResizeViewport={vi.fn()}
        onToggleViewport={vi.fn()}
        onCreateScene={vi.fn()}
        onCreateAnalysis={vi.fn()}
        onCreateBifurcation={vi.fn()}
        onRenameViewport={vi.fn()}
        onDeleteViewport={vi.fn()}
        onComputeEventSeriesFromSamples={onComputeEventSeriesFromSamples}
      />
    )

    await waitFor(() => {
      const props = plotlyCalls.find(
        (entry) =>
          entry.plotId === analysisResult.nodeId && entry.data.length > 0
      )
      expect(props?.onPointClick).toBeDefined()
      const trace = props?.data.find(
        (entry) =>
          'uid' in entry &&
          entry.uid === orbitResult.nodeId &&
          'mode' in entry &&
          entry.mode === 'markers'
      ) as { customdata?: unknown[] } | undefined
      const customdata = trace?.customdata?.[0]
      expect(customdata).toBeTruthy()

      props?.onPointClick?.({
        uid: orbitResult.nodeId,
        customdata
      })
    })

    expect(onSelectObject).toHaveBeenCalledWith(orbitResult.nodeId)
    expect(onSelectOrbitPoint).toHaveBeenCalledWith({
      orbitId: orbitResult.nodeId,
      pointIndex: 1,
      hitIndex: 2,
      time: 0.125,
      state: [0.5, 0.25]
    })
  })

  it('filters event map hits through positivity constraints', async () => {
    const config: SystemConfig = {
      name: 'Analysis_Constraint_System',
      equations: ['y', '-x'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    }
    let system = createSystem({ name: 'Analysis_Constraint_System', config })
    const analysisResult = addAnalysisViewport(system, 'Event_Map_1')
    system = analysisResult.system
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Constraint_Target',
      systemName: config.name,
      data: [
        [0, 0, 1],
        [0.1, 1, 0],
        [0.2, 2, -1]
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1
    }
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system
    system = updateAnalysisViewport(system, analysisResult.nodeId, {
      sourceNodeIds: [orbitResult.nodeId],
      event: {
        mode: 'cross_up',
        source: { kind: 'custom', expression: 'x' },
        level: 0,
        positivityConstraints: ['y']
      },
      axes: {
        x: { kind: 'observable', expression: 'x', hitOffset: 0, label: 'x@n' },
        y: { kind: 'hit_index', label: 'n' },
        z: null
      }
    })
    const onComputeEventSeriesFromSamples = vi.fn().mockResolvedValue({
      hits: [
        {
          order: 0,
          sample_index: 1,
          time: 0.1,
          state: [1, 0],
          observable_values: [1, 2]
        },
        {
          order: 1,
          sample_index: 2,
          time: 0.2,
          state: [2, -1],
          observable_values: [2, -3]
        }
      ]
    })

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
        onCreateAnalysis={vi.fn()}
        onCreateBifurcation={vi.fn()}
        onRenameViewport={vi.fn()}
        onDeleteViewport={vi.fn()}
        onComputeEventSeriesFromSamples={onComputeEventSeriesFromSamples}
      />
    )

    await waitFor(() => {
      const calls = plotlyCalls.filter(
        (entry) =>
          entry.plotId === analysisResult.nodeId && entry.data.length > 0
      )
      const props = calls[calls.length - 1]
      const trace = props?.data[0] as { x?: number[]; y?: number[] } | undefined
      expect(trace?.x).toEqual([1])
      expect(trace?.y).toEqual([0])
    })

    expect(onComputeEventSeriesFromSamples).toHaveBeenCalledWith(
      expect.objectContaining({
        observableExpressions: ['x', 'y']
      }),
      expect.anything()
    )
  })
})
