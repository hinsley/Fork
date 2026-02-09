import { render, waitFor } from '@testing-library/react'
import type { Data, Layout } from 'plotly.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewportPanel } from './ViewportPanel'
import type { ComputeIsoclineResult } from '../compute/ForkCoreClient'
import {
  addObject,
  addBranch,
  addBifurcationDiagram,
  addScene,
  createSystem,
  updateLimitCycleRenderTarget,
  updateBifurcationDiagram,
  updateScene,
} from '../system/model'
import type {
  ContinuationObject,
  ContinuationSettings,
  EquilibriumObject,
  IsoclineObject,
  LimitCycleObject,
  OrbitObject,
  Scene,
  SystemConfig,
} from '../system/types'
import type { BranchPointSelection } from './branchPointSelection'
import { nowIso } from '../utils/determinism'

type PlotlyProps = {
  plotId: string
  data: Data[]
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

type RenderPanelOverrides = {
  branchPointSelection?: BranchPointSelection
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
    parameters: snapshot.parameters,
  })
}

describe('ViewportPanel view state wiring', () => {
  beforeEach(() => {
    plotlyCalls.length = 0
  })

  it('omits axis ranges from 2D layouts but seeds initialView', () => {
    let system = createSystem({ name: '2D_System' })
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
    expect(props?.layout?.xaxis?.title).toMatchObject({ text: 'x' })
    expect(props?.layout?.yaxis?.title).toMatchObject({ text: 'y' })
    expect(props?.viewRevision).toBe(5)
    expect(props?.initialView).toMatchObject({
      'xaxis.range': [-2, 2],
      'yaxis.range': [1, 3],
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
      type: 'map',
    }
    let system = createSystem({ name: 'Map2D_System', config })
    const sceneResult = addScene(system, 'Scene Map 2D')
    system = sceneResult.system

    renderPanel(system)

    const props = plotlyCalls.find((entry) => entry.plotId === sceneResult.nodeId)
    expect(props).toBeTruthy()
    expect(props?.layout?.scene).toBeUndefined()
    expect(props?.layout?.xaxis?.title).toMatchObject({ text: 'u' })
    expect(props?.layout?.yaxis?.title).toMatchObject({ text: 'v' })
  })

  it('marks autorange when a stored axis range is null', () => {
    let system = createSystem({ name: 'Auto_System' })
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
    let system = createSystem({ name: '3D_System', config })
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
    expect(props?.layout?.scene?.aspectmode).toBe('cube')
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
    let system = createSystem({ name: '3D_Missing_Camera', config })
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
        { variableName: 'y', min: -2, max: 2, samples: 24 },
      ],
      frozenState: [0, 0],
      parameters: [...system.config.params],
      lastComputed: {
        source: { kind: 'custom', expression: 'x + y' },
        expression: 'x + y',
        level: 0,
        axes: [
          { variableName: 'x', min: -2, max: 2, samples: 24 },
          { variableName: 'y', min: -2, max: 2, samples: 24 },
        ],
        frozenState: [0, 0],
        parameters: [...system.config.params],
        computedAt: nowIso(),
      },
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
            segments: [0, 1],
          },
        },
      },
    })

    const props = plotlyCalls.find((entry) => entry.plotId === sceneResult.nodeId)
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
        type: 'flow',
      },
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
      createdAt: nowIso(),
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
            state: [0, 0, 1, 0, 2, 0, 0.5, 0, 1.5, 0, 0, 0, 0.25, 8, 0.02, 0, 0],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
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
          free_eps1: false,
        },
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 5,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      } as ContinuationSettings,
      timestamp: nowIso(),
      params: [0.2, 0.1],
    }
    const addedBranch = addBranch(addedObject.system, homocBranch, addedObject.nodeId)
    system = updateLimitCycleRenderTarget(addedBranch.system, addedObject.nodeId, {
      type: 'branch',
      branchId: addedBranch.nodeId,
      pointIndex: 0,
    })

    renderPanel(system)

    const sceneId = sceneResult.nodeId
    const props = plotlyCalls.find((entry) => entry.plotId === sceneId)
    expect(props).toBeTruthy()
    const trace = props?.data.find(
      (entry) => 'uid' in entry && entry.uid === addedObject.nodeId && 'mode' in entry
    ) as { mode?: string; x?: Array<number | null>; y?: Array<number | null> } | undefined
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

  it('renders cached 1D isocline points as diagonal markers in map scenes', () => {
    const config: SystemConfig = {
      name: 'IsoMap1D',
      equations: ['r * x * (1 - x)'],
      params: [2.5],
      paramNames: ['r'],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map',
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
        computedAt: nowIso(),
      },
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
            points: [0.25, 0.75],
          },
        },
      },
    })

    const props = plotlyCalls.find((entry) => entry.plotId === sceneResult.nodeId)
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

  it('renders cached 3D isocline triangles as meshes', () => {
    const config: SystemConfig = {
      name: 'Iso3D',
      equations: ['x', 'y', 'z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
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
        { variableName: 'z', min: -1, max: 1, samples: 8 },
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
          { variableName: 'z', min: -1, max: 1, samples: 8 },
        ],
        frozenState: [0, 0, 0],
        parameters: [],
        computedAt: nowIso(),
      },
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
            triangles: [0, 1, 2],
          },
        },
      },
    })

    const props = plotlyCalls.find((entry) => entry.plotId === sceneResult.nodeId)
    expect(props).toBeTruthy()
    const meshTrace = props?.data.find(
      (entry) => 'uid' in entry && entry.uid === added.nodeId && entry.type === 'mesh3d'
    ) as { x?: number[]; i?: Uint32Array | number[] } | undefined
    expect(meshTrace).toBeTruthy()
    expect(meshTrace?.x).toEqual([0, 1, 0])
    expect(Array.from(meshTrace?.i ?? [])).toEqual([0])
  })

  it('omits diagram ranges from layout but seeds initialView', () => {
    let system = createSystem({ name: 'Diagram_System' })
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(diagramResult.system, diagramResult.nodeId, {
      axisRanges: { x: [-3, 3], y: [2, 4] },
      viewRevision: 7,
    })

    renderPanel(system)

    const props = plotlyCalls.find((entry) => entry.plotId === diagramResult.nodeId)
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
      'yaxis.range': [2, 4],
    })
    expect(props?.layout?.legend).toMatchObject({
      itemclick: false,
      itemdoubleclick: false,
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
      type: 'flow',
    }
    const defaultSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-5,
      max_step_size: 0.1,
      max_steps: 100,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6,
    }
    let system = createSystem({ name: 'Selection_System', config })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit A',
      systemName: config.name,
      data: [
        [0, 0.1],
        [0.1, 0.2],
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
      parameters: [...config.params],
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
          { state: [0.4], param_value: 1.1, stability: 'None', eigenvalues: [] },
          { state: [0.8], param_value: 1.3, stability: 'None', eigenvalues: [] },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: { type: 'Equilibrium' },
      },
      settings: defaultSettings,
      timestamp: nowIso(),
      params: [...config.params],
    }
    const branchResult = addBranch(system, branch, orbitResult.nodeId)
    system = branchResult.system
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(diagramResult.system, diagramResult.nodeId, {
      xAxis: { kind: 'parameter', name: 'mu' },
      yAxis: { kind: 'state', name: 'x' },
    })

    renderPanel(system, {
      branchPointSelection: { branchId: branchResult.nodeId, pointIndex: 1 },
    })

    const props = plotlyCalls.find((entry) => entry.plotId === diagramResult.nodeId)
    expect(props).toBeTruthy()
    const selectedTrace = props?.data.find(
      (trace) => trace.name === 'eq_branch selected point'
    ) as { x?: number[]; y?: number[]; customdata?: number[] } | undefined
    expect(selectedTrace).toBeTruthy()
    expect(selectedTrace?.x).toEqual([1.3])
    expect(selectedTrace?.y).toEqual([0.8])
    expect(selectedTrace?.customdata).toEqual([1])
  })

  it('renders full limit cycles on state-variable bifurcation diagrams for flows', () => {
    const config: SystemConfig = {
      name: 'LimitCycle_Diagram',
      equations: ['x', 'y'],
      params: [0.4],
      paramNames: ['mu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow',
    }
    const defaultSettings: ContinuationSettings = {
      step_size: 0.01,
      min_step_size: 1e-5,
      max_step_size: 0.1,
      max_steps: 100,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6,
    }
    let system = createSystem({ name: 'LimitCycle_Diagram', config })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit A',
      systemName: config.name,
      data: [
        [0, 0.1, 0.2],
        [0.1, 0.2, 0.3],
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
      parameters: [...config.params],
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
            eigenvalues: [],
          },
          {
            state: [0, 0, 1, 1, 0, 1, 2],
            param_value: 0.6,
            stability: 'PeriodDoubling',
            eigenvalues: [],
          },
        ],
        bifurcations: [1],
        indices: [0, 1],
        branch_type: { type: 'LimitCycle', ntst: 2, ncol: 1 },
      },
      settings: defaultSettings,
      timestamp: nowIso(),
      params: [...config.params],
    }
    const branchResult = addBranch(system, branch, orbitResult.nodeId)
    system = branchResult.system
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(diagramResult.system, diagramResult.nodeId, {
      xAxis: { kind: 'state', name: 'x' },
      yAxis: { kind: 'state', name: 'y' },
    })

    renderPanel(system)

    const props = plotlyCalls.find((entry) => entry.plotId === diagramResult.nodeId)
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
      (trace) =>
        'name' in trace && trace.name === `${branch.name} bifurcations`
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
      type: 'flow',
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
        eigenpairs: [],
      },
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
      step_tolerance: 1e-6,
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
              0.1, 0.2, 0.1, 8, 0.02, 0, 0,
            ],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [
              // mesh + stage
              1, 1, 2, 1, 3, 1, 1.5, 1, 2.5, 1,
              // x0 + p2 + extras/tail
              0.4, 0.5, 0.12, 9, 0.02, 0, 0,
            ],
            param_value: 0.3,
            stability: 'None',
            eigenvalues: [],
          },
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
          free_eps1: false,
        },
      },
      settings: continuationSettings,
      timestamp: nowIso(),
      params: [...config.params],
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    system = branchResult.system
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = updateBifurcationDiagram(diagramResult.system, diagramResult.nodeId, {
      xAxis: { kind: 'state', name: 'x' },
      yAxis: { kind: 'state', name: 'y' },
    })

    renderPanel(system)

    const props = plotlyCalls.find((entry) => entry.plotId === diagramResult.nodeId)
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
      type: 'map',
    }
    let system = createSystem({ name: 'Map_System', config })
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
        cycle_points: [
          [0.3],
          [0.9],
        ],
      },
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
      type: 'map',
    }
    let system = createSystem({ name: 'Map_System', config })
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
        cycle_points: [[0.3]],
      },
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
      type: 'map',
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
        cycle_points: [
          [0.3],
          [0.9],
        ],
      },
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
      type: 'map',
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
        cycle_points: [[0.3]],
      },
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
})
