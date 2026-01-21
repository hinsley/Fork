import { render, waitFor } from '@testing-library/react'
import type { Data, Layout } from 'plotly.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewportPanel } from './ViewportPanel'
import {
  addObject,
  addBranch,
  addBifurcationDiagram,
  addScene,
  createSystem,
  updateBifurcationDiagram,
  updateScene,
} from '../system/model'
import type {
  ContinuationObject,
  ContinuationSettings,
  EquilibriumObject,
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
    />
  )
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
    expect(props?.viewRevision).toBe(5)
    expect(props?.initialView).toMatchObject({
      'xaxis.range': [-2, 2],
      'yaxis.range': [1, 3],
    })
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
    )
    expect(selectedTrace).toBeTruthy()
    expect(selectedTrace?.x).toEqual([1.3])
    expect(selectedTrace?.y).toEqual([0.8])
    expect(selectedTrace?.customdata).toEqual([1])
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
    )
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
