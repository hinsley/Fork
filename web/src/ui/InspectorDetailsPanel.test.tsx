import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDemoSystem, createPeriodDoublingSystem } from '../system/fixtures'
import { InspectorDetailsPanel } from './InspectorDetailsPanel'
import { useState } from 'react'
import {
  DEFAULT_SCENE_CAMERA,
  addScene,
  addBranch,
  addObject,
  createSystem,
  renameNode,
  toggleNodeVisibility,
  updateBranch,
  updateLimitCycleRenderTarget,
  updateNodeRender,
} from '../system/model'
import { buildSubsystemSnapshot } from '../system/subsystemGateway'
import { renderPlot } from '../viewports/plotly/plotlyAdapter'
import type {
  ContinuationObject,
  EquilibriumObject,
  IsoclineObject,
  LimitCycleObject,
  OrbitObject,
  System,
  SystemConfig,
} from '../system/types'

const continuationSettings = {
  step_size: 0.01,
  min_step_size: 1e-6,
  max_step_size: 0.1,
  max_steps: 50,
  corrector_steps: 4,
  corrector_tolerance: 1e-6,
  step_tolerance: 1e-6,
}

const stateSpaceStrideCycleLikeBranchTypes = [
  'homoclinic_curve',
  'homotopy_saddle_curve',
  'pd_curve',
  'lpc_curve',
  'ns_curve',
] as const

type StateSpaceStrideCycleLikeBranchType = (typeof stateSpaceStrideCycleLikeBranchTypes)[number]

function makeStateSpaceStrideBranchTypeData(
  branchType: StateSpaceStrideCycleLikeBranchType
): ContinuationObject['data']['branch_type'] {
  switch (branchType) {
    case 'homoclinic_curve':
      return {
        type: 'HomoclinicCurve',
        ntst: 4,
        ncol: 2,
        param1_name: 'mu',
        param2_name: 'nu',
        free_time: true,
        free_eps0: true,
        free_eps1: true,
      }
    case 'homotopy_saddle_curve':
      return {
        type: 'HomotopySaddleCurve',
        ntst: 4,
        ncol: 2,
        param1_name: 'mu',
        param2_name: 'nu',
        stage: 'StageD',
      }
    case 'pd_curve':
      return { type: 'PDCurve', param1_name: 'mu', param2_name: 'nu', ntst: 4, ncol: 2 }
    case 'lpc_curve':
      return { type: 'LPCCurve', param1_name: 'mu', param2_name: 'nu', ntst: 4, ncol: 2 }
    case 'ns_curve':
      return { type: 'NSCurve', param1_name: 'mu', param2_name: 'nu', ntst: 4, ncol: 2 }
  }
}

function createStateSpaceStrideBranchFixture(branchType: StateSpaceStrideCycleLikeBranchType) {
  const config: SystemConfig = {
    name: `Stride_Flow_${branchType}`,
    equations: ['y', '-x'],
    params: [0.2, 0.1],
    paramNames: ['mu', 'nu'],
    varNames: ['x', 'y'],
    solver: 'rk4',
    type: 'flow',
  }
  const baseSystem = createSystem({ name: config.name, config })
  const equilibrium: EquilibriumObject = {
    type: 'equilibrium',
    name: 'Eq_Stride',
    systemName: config.name,
  }
  const withEquilibrium = addObject(baseSystem, equilibrium)
  const branch: ContinuationObject = {
    type: 'continuation',
    name: `${branchType}_mu_nu`,
    systemName: config.name,
    parameterName: 'mu, nu',
    parentObject: equilibrium.name,
    startObject: equilibrium.name,
    branchType,
    data: {
      points: [
        {
          state: new Array(24).fill(0),
          param_value: 0.2,
          param2_value: 0.1,
          stability: 'None',
          eigenvalues: [],
        },
      ],
      bifurcations: [0],
      indices: [0],
      branch_type: makeStateSpaceStrideBranchTypeData(branchType),
    },
    settings: continuationSettings,
    timestamp: new Date().toISOString(),
    params: [...config.params],
  }
  return addBranch(withEquilibrium.system, branch, withEquilibrium.nodeId)
}

function renderInspectorForStateSpaceStride(
  system: System,
  selectedNodeId: string,
  onUpdateRender: ReturnType<typeof vi.fn>
) {
  render(
    <InspectorDetailsPanel
      system={system}
      selectedNodeId={selectedNodeId}
      view="selection"
      theme="light"
      onRename={vi.fn()}
      onToggleVisibility={vi.fn()}
      onUpdateRender={onUpdateRender}
      onUpdateScene={vi.fn()}
      onUpdateBifurcationDiagram={vi.fn()}
      onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
      onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
      onRunOrbit={vi.fn().mockResolvedValue(undefined)}
      onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
      onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
      onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
      onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
      onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
      onExtendBranch={vi.fn().mockResolvedValue(undefined)}
      onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
      onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
      onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
      onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
      onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
      onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
    />
  )
}

describe('InspectorDetailsPanel', () => {
  it('binds name and render fields', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const onRename = vi.fn()
    const onToggleVisibility = vi.fn()
    const onUpdateRender = vi.fn()
    const onUpdateScene = vi.fn()
    const onUpdateBifurcationDiagram = vi.fn()
    const onUpdateSystem = vi.fn().mockResolvedValue(undefined)
    const onValidateSystem = vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })
    const onRunOrbit = vi.fn().mockResolvedValue(undefined)
    const onSolveEquilibrium = vi.fn().mockResolvedValue(undefined)
    const onCreateEquilibriumBranch = vi.fn().mockResolvedValue(undefined)
    const onCreateBranchFromPoint = vi.fn().mockResolvedValue(undefined)
    const onExtendBranch = vi.fn().mockResolvedValue(undefined)
    const onCreateFoldCurveFromPoint = vi.fn().mockResolvedValue(undefined)
    const onCreateHopfCurveFromPoint = vi.fn().mockResolvedValue(undefined)

    function Wrapper() {
      const [state, setState] = useState(system)
      return (
        <InspectorDetailsPanel
          system={state}
          selectedNodeId={objectNodeId}
          view="selection"
          theme="light"
          onRename={(id, name) => {
            onRename(id, name)
            setState((prev) => renameNode(prev, id, name))
          }}
          onToggleVisibility={(id) => {
            onToggleVisibility(id)
            setState((prev) => toggleNodeVisibility(prev, id))
          }}
          onUpdateRender={(id, render) => {
            onUpdateRender(id, render)
            setState((prev) => updateNodeRender(prev, id, render))
          }}
          onUpdateScene={onUpdateScene}
          onUpdateBifurcationDiagram={onUpdateBifurcationDiagram}
          onUpdateSystem={async (system) => {
            onUpdateSystem(system)
            setState((prev) => ({ ...prev, config: system }))
          }}
          onValidateSystem={onValidateSystem}
          onRunOrbit={onRunOrbit}
          onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
          onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
          onSolveEquilibrium={onSolveEquilibrium}
          onCreateEquilibriumBranch={onCreateEquilibriumBranch}
          onCreateBranchFromPoint={onCreateBranchFromPoint}
          onExtendBranch={onExtendBranch}
          onCreateFoldCurveFromPoint={onCreateFoldCurveFromPoint}
          onCreateHopfCurveFromPoint={onCreateHopfCurveFromPoint}
          onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
          onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        />
      )
    }

    render(<Wrapper />)

    const nameInput = screen.getByTestId('inspector-name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Orbit Q')
    expect(onRename).not.toHaveBeenCalled()
    await user.tab()
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenLastCalledWith(objectNodeId, 'Orbit Q')

    await user.click(screen.getByTestId('inspector-visibility'))
    expect(onToggleVisibility).toHaveBeenCalledWith(objectNodeId)

    const lineWidth = screen.getByTestId('inspector-line-width')
    await user.clear(lineWidth)
    await user.type(lineWidth, '3')
    expect(onUpdateRender).toHaveBeenLastCalledWith(objectNodeId, { lineWidth: 3 })
  }, 15000)

  it('updates branch line style render settings', async () => {
    const user = userEvent.setup()
    const { system, branchNodeId } = createDemoSystem()
    const onUpdateRender = vi.fn()

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={branchNodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={onUpdateRender}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const lineStyle = screen.getByTestId('inspector-line-style')
    await user.selectOptions(lineStyle, 'dashed')
    expect(onUpdateRender).toHaveBeenLastCalledWith(branchNodeId, { lineStyle: 'dashed' })
  })

  it('updates state space stride for limit cycle branches', async () => {
    const { system } = createPeriodDoublingSystem()
    const branchNodeId = Object.keys(system.branches)[0]
    if (!branchNodeId) {
      throw new Error('Expected a limit cycle branch node.')
    }
    const onUpdateRender = vi.fn()

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={branchNodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={onUpdateRender}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const strideInput = screen.getByTestId('inspector-state-space-stride')
    fireEvent.change(strideInput, { target: { value: '3' } })
    expect(onUpdateRender).toHaveBeenLastCalledWith(branchNodeId, {
      stateSpaceStride: 3,
    })
  })

  it.each(stateSpaceStrideCycleLikeBranchTypes)(
    'updates state space stride for %s branches',
    (branchType) => {
      const { system, nodeId } = createStateSpaceStrideBranchFixture(branchType)
      const onUpdateRender = vi.fn()

      renderInspectorForStateSpaceStride(system, nodeId, onUpdateRender)

      const strideInput = screen.getByTestId('inspector-state-space-stride')
      fireEvent.change(strideInput, { target: { value: '5' } })
      expect(onUpdateRender).toHaveBeenLastCalledWith(nodeId, {
        stateSpaceStride: 5,
      })
    }
  )

  it('applies parameter overrides for selected objects', async () => {
    const user = userEvent.setup()
    const system = createSystem({
      name: 'Param_Override',
      config: {
        name: 'Param_Override',
        equations: ['y', '-x'],
        params: [0.1, 0.2],
        paramNames: ['mu', 'beta'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Override',
      systemName: system.config.name,
      data: [],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
    }
    const { system: next, nodeId } = addObject(system, orbit)
    const onUpdateObjectParams = vi.fn()

    render(
      <InspectorDetailsPanel
        system={next}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateObjectParams={onUpdateObjectParams}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('parameters-toggle'))
    await user.clear(screen.getByTestId('param-override-0'))
    await user.type(screen.getByTestId('param-override-0'), '1.2')
    await user.clear(screen.getByTestId('param-override-1'))
    await user.type(screen.getByTestId('param-override-1'), '3.4')

    await waitFor(() =>
      expect(onUpdateObjectParams).toHaveBeenLastCalledWith(nodeId, [1.2, 3.4])
    )
  })

  it('applies decimal frozen-variable values for selected objects', async () => {
    const user = userEvent.setup()
    const system = createSystem({
      name: 'Frozen_Decimal',
      config: {
        name: 'Frozen_Decimal',
        equations: ['y', '-x'],
        params: [0.1],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Frozen',
      systemName: system.config.name,
      data: [],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
      frozenVariables: { frozenValuesByVarName: { x: 0 } },
    }
    const { system: next, nodeId } = addObject(system, orbit)
    const onUpdateObjectFrozenVariables = vi.fn()

    render(
      <InspectorDetailsPanel
        system={next}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateObjectParams={vi.fn()}
        onUpdateObjectFrozenVariables={onUpdateObjectFrozenVariables}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('frozen-variables-toggle'))
    const xFrozenValueInput = screen.getByTestId('frozen-variable-value-x')
    await user.clear(xFrozenValueInput)
    await user.type(xFrozenValueInput, '0.25')

    await waitFor(() =>
      expect(onUpdateObjectFrozenVariables).toHaveBeenLastCalledWith(nodeId, { x: 0.25 })
    )
  })

  it('shows the custom parameters tag in the parameters header when overrides exist', () => {
    const systemConfig = {
      name: 'Custom_Param_System',
      equations: ['x'],
      params: [0.2, 0.4],
      paramNames: ['a', 'b'],
      varNames: ['x'],
      solver: 'rk4',
      type: 'flow' as const,
    }
    const system = createSystem({ name: 'Custom_Param_System', config: systemConfig })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit Custom',
      systemName: system.config.name,
      data: [[0, 1]],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
      customParameters: [0.2, 0.9],
    }

    const { system: next, nodeId } = addObject(system, orbit)

    render(
      <InspectorDetailsPanel
        system={next}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateObjectParams={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const header = screen.getByTestId('parameters-toggle')
    expect(within(header).getByText('custom')).toBeInTheDocument()
  })

  it('hides the custom parameters tag when overrides are not present', () => {
    const systemConfig = {
      name: 'Default_Param_System',
      equations: ['x'],
      params: [0.2, 0.4],
      paramNames: ['a', 'b'],
      varNames: ['x'],
      solver: 'rk4',
      type: 'flow' as const,
    }
    const system = createSystem({ name: 'Default_Param_System', config: systemConfig })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit Default',
      systemName: system.config.name,
      data: [[0, 1]],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
    }

    const { system: next, nodeId } = addObject(system, orbit)

    render(
      <InspectorDetailsPanel
        system={next}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateObjectParams={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const header = screen.getByTestId('parameters-toggle')
    expect(within(header).queryByText('custom')).toBeNull()
  })

  it('updates isocline controls and runs manual compute', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Iso_Config',
      equations: ['x + y', 'y - z', 'x - z'],
      params: [0.1],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    const system = createSystem({ name: config.name, config })
    const isocline: IsoclineObject = {
      type: 'isocline',
      name: 'Iso_1',
      systemName: config.name,
      source: { kind: 'custom', expression: 'x + y' },
      level: 0,
      axes: [
        { variableName: 'x', min: -2, max: 2, samples: 32 },
        { variableName: 'y', min: -2, max: 2, samples: 32 },
      ],
      frozenState: [0, 0, 1],
      parameters: [...config.params],
    }
    const added = addObject(system, isocline)
    const onUpdateIsoclineObject = vi.fn()
    const onComputeIsocline = vi.fn().mockResolvedValue({
      geometry: 'segments',
      dim: 3,
      points: [0, 0, 1, 1, 1, 1],
      segments: [0, 1],
    })

    render(
      <InspectorDetailsPanel
        system={added.system}
        selectedNodeId={added.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateObjectParams={vi.fn()}
        onUpdateIsoclineObject={onUpdateIsoclineObject}
        onComputeIsocline={onComputeIsocline}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('isocline-toggle'))
    expect(
      screen.getByRole('region', { name: 'Isocline active variable ranges' })
    ).toBeInTheDocument()
    expect(screen.getByTestId('isocline-frozen-table')).toBeInTheDocument()
    expect(screen.getByTestId('isocline-parameter-table')).toBeInTheDocument()
    const levelInput = screen.getByTestId('isocline-level')
    const minInput = screen.getByTestId('isocline-axis-min-x')
    const samplesInput = screen.getByTestId('isocline-axis-samples-x')
    const frozenInput = screen.getByTestId('isocline-frozen-z')
    fireEvent.change(levelInput, { target: { value: '-' } })
    fireEvent.change(minInput, { target: { value: '-' } })
    fireEvent.change(frozenInput, { target: { value: '-' } })
    expect(levelInput).toHaveValue('-')
    expect(minInput).toHaveValue('-')
    expect(frozenInput).toHaveValue('-')
    await user.clear(levelInput)
    await user.type(levelInput, '1.5')
    await user.clear(minInput)
    await user.type(minInput, '-1')
    await user.clear(samplesInput)
    await user.type(samplesInput, '16')
    expect(samplesInput).toHaveValue('16')
    await user.selectOptions(screen.getByTestId('isocline-source-kind'), 'flow_derivative')
    const expressionInput = screen.getByTestId('isocline-expression')
    fireEvent.change(expressionInput, { target: { value: 'x + y - z' } })
    fireEvent.change(frozenInput, { target: { value: '2' } })
    expect(screen.getByRole('button', { name: 'Compute' })).toBeInTheDocument()
    await user.click(screen.getByTestId('isocline-compute'))

    expect(onUpdateIsoclineObject).toHaveBeenCalledWith(added.nodeId, {
      level: 1.5,
    })
    expect(onUpdateIsoclineObject).toHaveBeenCalledWith(added.nodeId, {
      source: { kind: 'flow_derivative', variableName: 'x' },
    })

    expect(onUpdateIsoclineObject).toHaveBeenCalledWith(
      added.nodeId,
      expect.objectContaining({
        source: { kind: 'custom', expression: 'x + y - z' },
      })
    )
    expect(onUpdateIsoclineObject).toHaveBeenCalledWith(
      added.nodeId,
      expect.objectContaining({
        axes: expect.arrayContaining([
          expect.objectContaining({ variableName: 'x', samples: 16 }),
        ]),
      })
    )
    expect(onUpdateIsoclineObject).toHaveBeenCalledWith(added.nodeId, { frozenState: [0, 0, 2] })
    expect(onComputeIsocline).toHaveBeenCalledWith(
      { isoclineId: added.nodeId },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  }, 15000)

  it('blocks compute when isocline drafts are unparsable', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Iso_Parse_Error',
      equations: ['x + y', 'y - z', 'x - z'],
      params: [0.1],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    const system = createSystem({ name: config.name, config })
    const isocline: IsoclineObject = {
      type: 'isocline',
      name: 'Iso_Parse_Error_Object',
      systemName: config.name,
      source: { kind: 'custom', expression: 'x + y' },
      level: 0,
      axes: [
        { variableName: 'x', min: -2, max: 2, samples: 32 },
        { variableName: 'y', min: -2, max: 2, samples: 32 },
      ],
      frozenState: [0, 0, 0],
      parameters: [...config.params],
    }
    const added = addObject(system, isocline)
    const onComputeIsocline = vi.fn().mockResolvedValue(null)

    render(
      <InspectorDetailsPanel
        system={added.system}
        selectedNodeId={added.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateObjectParams={vi.fn()}
        onUpdateIsoclineObject={vi.fn()}
        onComputeIsocline={onComputeIsocline}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('isocline-toggle'))
    fireEvent.change(screen.getByTestId('isocline-level'), { target: { value: '-' } })
    const callsBefore = onComputeIsocline.mock.calls.length
    await user.click(screen.getByTestId('isocline-compute'))

    expect(onComputeIsocline).toHaveBeenCalledTimes(callsBefore)
    expect(screen.getByText('Isocline value must be a valid real number.')).toBeInTheDocument()
  })

  it('surfaces compute-time semantic validation errors for isoclines', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Iso_Semantic_Error',
      equations: ['x + y', 'y - z', 'x - z'],
      params: [0.1],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    const system = createSystem({ name: config.name, config })
    const isocline: IsoclineObject = {
      type: 'isocline',
      name: 'Iso_Semantic_Error_Object',
      systemName: config.name,
      source: { kind: 'custom', expression: 'x + y' },
      level: 0,
      axes: [
        { variableName: 'x', min: -2, max: 2, samples: 32 },
        { variableName: 'y', min: -2, max: 2, samples: 32 },
      ],
      frozenState: [0, 0, 0],
      parameters: [...config.params],
    }
    const added = addObject(system, isocline)
    const onComputeIsocline = vi
      .fn()
      .mockRejectedValue(new Error('Each axis range must be finite with max > min.'))

    render(
      <InspectorDetailsPanel
        system={added.system}
        selectedNodeId={added.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateObjectParams={vi.fn()}
        onUpdateIsoclineObject={vi.fn()}
        onComputeIsocline={onComputeIsocline}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('isocline-toggle'))
    fireEvent.change(screen.getByTestId('isocline-axis-min-x'), { target: { value: '5' } })
    fireEvent.change(screen.getByTestId('isocline-axis-max-x'), { target: { value: '-5' } })
    await user.click(screen.getByTestId('isocline-compute'))

    expect(onComputeIsocline).toHaveBeenCalledWith(
      { isoclineId: added.nodeId },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    await waitFor(() =>
      expect(
        screen.getByText('Each axis range must be finite with max > min.')
      ).toBeInTheDocument()
    )
  })

  it('hides frozen-variable table when all variables are active for an isocline', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Iso_All_Active',
      equations: ['x + y', 'y - z', 'x - z'],
      params: [0.1],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    const system = createSystem({ name: config.name, config })
    const isocline: IsoclineObject = {
      type: 'isocline',
      name: 'Iso_All_Active_Object',
      systemName: config.name,
      source: { kind: 'custom', expression: 'x + y' },
      level: 0,
      axes: [
        { variableName: 'x', min: -2, max: 2, samples: 32 },
        { variableName: 'y', min: -2, max: 2, samples: 32 },
        { variableName: 'z', min: -2, max: 2, samples: 32 },
      ],
      frozenState: [0, 0, 0],
      parameters: [...config.params],
    }
    const added = addObject(system, isocline)

    render(
      <InspectorDetailsPanel
        system={added.system}
        selectedNodeId={added.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateObjectParams={vi.fn()}
        onUpdateIsoclineObject={vi.fn()}
        onComputeIsocline={vi.fn().mockResolvedValue(null)}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('isocline-toggle'))
    expect(screen.getByTestId('isocline-parameter-table')).toBeInTheDocument()
    expect(screen.queryByTestId('isocline-frozen-table')).toBeNull()
  })

  it('applies system changes from the editor', async () => {
    const user = userEvent.setup()
    const { system } = createDemoSystem()
    const onUpdateSystem = vi.fn().mockResolvedValue(undefined)
    const onValidateSystem = vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={null}
        view="system"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={onUpdateSystem}
        onValidateSystem={onValidateSystem}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const nameInput = screen.getByTestId('system-name')
    await user.clear(nameInput)
    await user.type(nameInput, 'NewSystem')

    await user.click(screen.getByTestId('system-apply'))

    expect(onUpdateSystem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'NewSystem' })
    )
  })

  it('runs orbit requests', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const onRunOrbit = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={objectNodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={onRunOrbit}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('orbit-run-toggle'))
    await user.clear(screen.getByTestId('orbit-run-duration'))
    await user.type(screen.getByTestId('orbit-run-duration'), '10')
    await user.clear(screen.getByTestId('orbit-run-dt'))
    await user.type(screen.getByTestId('orbit-run-dt'), '0.5')
    await user.clear(screen.getByTestId('orbit-run-ic-0'))
    await user.type(screen.getByTestId('orbit-run-ic-0'), '1')
    await user.clear(screen.getByTestId('orbit-run-ic-1'))
    await user.type(screen.getByTestId('orbit-run-ic-1'), '2')

    await user.click(screen.getByTestId('orbit-run-submit'))

    expect(onRunOrbit).toHaveBeenCalledWith({
      orbitId: objectNodeId,
      initialState: [1, 2],
      duration: 10,
      dt: 0.5,
    })
  })

  it('keeps manual orbit preview page navigation when a point is selected', async () => {
    const user = userEvent.setup()
    let system = createSystem({ name: 'Orbit_Preview_Nav' })
    const orbitRows = Array.from({ length: 25 }, (_, index) => {
      const t = index * 0.1
      return [t, Math.sin(t), Math.cos(t)]
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Preview_Nav',
      systemName: system.config.name,
      data: orbitRows,
      t_start: 0,
      t_end: 2.4,
      dt: 0.1,
      parameters: [],
    }
    const added = addObject(system, orbit)
    system = added.system

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={added.nodeId}
        view="selection"
        theme="light"
        orbitPointSelection={{ orbitId: added.nodeId, pointIndex: 17 }}
        onOrbitPointSelect={vi.fn()}
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const orbitDataToggle = screen.getByTestId('orbit-data-toggle')
    const orbitDataDetails = orbitDataToggle.closest('details')
    if (orbitDataDetails && !orbitDataDetails.open) {
      await user.click(orbitDataToggle)
    }

    expect(screen.getByText('Page 2 of 3')).toBeVisible()
    await user.click(screen.getByTestId('orbit-preview-next'))
    expect(screen.getByText('Page 3 of 3')).toBeVisible()

    const tableRegion = screen.getByRole('region', { name: 'Orbit data preview' })
    const rows = within(tableRegion).getAllByRole('row')
    expect(within(rows[1]).getByText('20')).toBeVisible()
  })

  it('renders paged limit-cycle data preview and keeps selected rows in view', async () => {
    const user = userEvent.setup()
    let system = createSystem({
      name: 'Limit_Cycle_Preview_Nav',
      config: {
        name: 'Limit_Cycle_Preview_Nav',
        equations: ['y', '-x'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const ntst = 12
    const ncol = 2
    const period = 8
    const profilePointCount = ntst * ncol + 1
    const state: number[] = []
    for (let index = 0; index < profilePointCount; index += 1) {
      const theta = (index / (profilePointCount - 1)) * Math.PI * 2
      state.push(Math.cos(theta), Math.sin(theta))
    }
    state.push(period)
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Preview_Nav',
      systemName: system.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_A' },
      ntst,
      ncol,
      period,
      state,
      createdAt: new Date().toISOString(),
    }
    const added = addObject(system, limitCycle)
    system = added.system
    const onLimitCyclePointSelect = vi.fn()

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={added.nodeId}
        view="selection"
        theme="light"
        limitCyclePointSelection={{ limitCycleId: added.nodeId, pointIndex: 17 }}
        onLimitCyclePointSelect={onLimitCyclePointSelect}
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const limitCycleDataToggle = screen.getByTestId('limit-cycle-data-toggle')
    const limitCycleDataDetails = limitCycleDataToggle.closest('details')
    if (limitCycleDataDetails && !limitCycleDataDetails.open) {
      await user.click(limitCycleDataToggle)
    }

    expect(screen.getByText('Page 2 of 3')).toBeVisible()
    await user.click(screen.getByTestId('limit-cycle-preview-next'))
    expect(screen.getByText('Page 3 of 3')).toBeVisible()

    const selectedRow = document.querySelector('.orbit-preview__table-grid tbody tr.is-selected')
    expect(selectedRow).toBeNull()

    const tableRegion = screen.getByRole('region', { name: 'Limit cycle data preview' })
    const rows = within(tableRegion).getAllByRole('row')
    await user.click(rows[1])
    expect(onLimitCyclePointSelect).toHaveBeenCalledWith({
      limitCycleId: added.nodeId,
      pointIndex: 20,
    })
  })

  it('creates limit cycle continuation from orbit data', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const onCreateLimitCycleFromOrbit = vi.fn().mockResolvedValue(undefined)
    const systemWithParams = {
      ...system,
      config: {
        ...system.config,
        paramNames: ['mu'],
        params: [0.5],
      },
    }

    render(
      <InspectorDetailsPanel
        system={systemWithParams}
        selectedNodeId={objectNodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={onCreateLimitCycleFromOrbit}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('limit-cycle-toggle'))
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-name'))
    await user.type(screen.getByTestId('limit-cycle-from-orbit-name'), 'lc_orbit')
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-branch-name'))
    await user.type(
      screen.getByTestId('limit-cycle-from-orbit-branch-name'),
      'lc_orbit_branch'
    )
    await user.selectOptions(
      screen.getByTestId('limit-cycle-from-orbit-parameter'),
      'mu'
    )
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-tolerance'))
    await user.type(screen.getByTestId('limit-cycle-from-orbit-tolerance'), '0.1')
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-ntst'))
    await user.type(screen.getByTestId('limit-cycle-from-orbit-ntst'), '20')
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-ncol'))
    await user.type(screen.getByTestId('limit-cycle-from-orbit-ncol'), '4')
    await user.selectOptions(
      screen.getByTestId('limit-cycle-from-orbit-direction'),
      'backward'
    )
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-orbit-step-size'), '0.01')
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-max-steps'))
    await user.type(screen.getByTestId('limit-cycle-from-orbit-max-steps'), '50')
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-min-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-orbit-min-step-size'), '1e-5')
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-max-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-orbit-max-step-size'), '0.1')
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-corrector-steps'))
    await user.type(screen.getByTestId('limit-cycle-from-orbit-corrector-steps'), '10')
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-corrector-tolerance'))
    await user.type(screen.getByTestId('limit-cycle-from-orbit-corrector-tolerance'), '1e-6')
    await user.clear(screen.getByTestId('limit-cycle-from-orbit-step-tolerance'))
    await user.type(screen.getByTestId('limit-cycle-from-orbit-step-tolerance'), '1e-6')
    await user.click(screen.getByTestId('limit-cycle-from-orbit-submit'))

    expect(onCreateLimitCycleFromOrbit).toHaveBeenCalledWith({
      orbitId: objectNodeId,
      limitCycleName: 'lc_orbit',
      branchName: 'lc_orbit_branch',
      parameterName: 'mu',
      tolerance: 0.1,
      ntst: 20,
      ncol: 4,
      settings: {
        step_size: 0.01,
        max_steps: 50,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        corrector_steps: 10,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      forward: false,
    })
  }, 15000)

  it('hides limit cycle menu for map orbits', () => {
    const config: SystemConfig = {
      name: 'Map_Orbit',
      equations: ['x'],
      params: [],
      paramNames: [],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map',
    }
    const baseSystem = createSystem({ name: config.name, config })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Map',
      systemName: config.name,
      data: [
        [0, 0.1],
        [1, 0.2],
      ],
      t_start: 0,
      t_end: 1,
      dt: 1,
      parameters: [],
    }
    const added = addObject(baseSystem, orbit)

    render(
      <InspectorDetailsPanel
        system={added.system}
        selectedNodeId={added.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.queryByTestId('limit-cycle-toggle')).toBeNull()
  })

  it('suggests cli-safe branch names for PD limit cycle continuation', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'PD_Name_System' })
    const configuredSystem = {
      ...baseSystem,
      config: {
        ...baseSystem.config,
        paramNames: ['mu beta'],
        params: [0.2],
      },
    }
    const lcObject: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC PD',
      systemName: configuredSystem.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit PD' },
      ntst: 20,
      ncol: 4,
      period: 6,
      state: [0.1, 0.2, 6],
      parameters: [...configuredSystem.config.params],
      parameterName: 'mu beta',
      paramValue: 0.2,
      createdAt: new Date().toISOString(),
    }
    const added = addObject(configuredSystem, lcObject)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc pd',
      systemName: configuredSystem.config.name,
      parameterName: 'mu beta',
      parentObject: lcObject.name,
      startObject: lcObject.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0.1, 0.2, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [0.1, 0.2, 6],
            param_value: 0.25,
            stability: 'PeriodDoubling',
            eigenvalues: [{ re: -1, im: 0 }],
          },
        ],
        bifurcations: [1],
        indices: [1, 0],
        branch_type: { type: 'LimitCycle', ntst: 20, ncol: 4 },
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 50,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...configuredSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-1'))
    await user.click(screen.getByTestId('limit-cycle-from-pd-toggle'))

    const branchInput = screen.getByTestId('limit-cycle-from-pd-branch-name')
    await waitFor(() => {
      expect(branchInput).toHaveAttribute('placeholder', 'lc_pd_lc_pd_idx1_mu_beta')
    })
  })

  it('suggests cli-safe branch names for equilibrium continuation', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Eq_Name_System' })
    const configuredSystem = {
      ...baseSystem,
      config: {
        ...baseSystem.config,
        paramNames: ['mu beta'],
        params: [0.1],
      },
    }
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq Name',
      systemName: configuredSystem.config.name,
      solution: {
        state: [0, 0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [],
      },
      parameters: [...configuredSystem.config.params],
    }
    const { system, nodeId } = addObject(configuredSystem, eqObject)

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('equilibrium-continuation-toggle'))
    const branchInput = screen.getByTestId('equilibrium-branch-name')

    await waitFor(() => {
      expect(branchInput).toHaveValue('Eq_Name_mu_beta')
    })
  })

  it('suggests cycle-prefixed branch names for map cycles', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Cycle_Name_System',
      equations: ['r * x * (1 - x)'],
      params: [2.5, 0.1],
      paramNames: ['mu', 'nu'],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map',
    }
    const baseSystem = createSystem({ name: config.name, config })
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Equilibrium_1',
      systemName: config.name,
      solution: {
        state: [0.1],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [],
        cycle_points: [[0.1], [0.2]],
      },
      lastSolverParams: {
        initialGuess: [0.1],
        maxSteps: 10,
        dampingFactor: 1,
        mapIterations: 2,
      },
      parameters: [...config.params],
    }
    const { system, nodeId } = addObject(baseSystem, eqObject)

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('equilibrium-continuation-toggle'))
    const branchInput = screen.getByTestId('equilibrium-branch-name')
    const paramSelect = screen.getByTestId('equilibrium-branch-parameter')

    await waitFor(() => {
      expect(branchInput).toHaveValue('cycle_mu')
    })

    await user.selectOptions(paramSelect, 'nu')

    await waitFor(() => {
      expect(branchInput).toHaveValue('cycle_nu')
    })
  })

  it('updates the default equilibrium continuation name when the parameter changes', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Eq_Param_System' })
    const configuredSystem = {
      ...baseSystem,
      config: {
        ...baseSystem.config,
        paramNames: ['alpha', 'gamma'],
        params: [0.1, 0.2],
      },
    }
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq Param',
      systemName: configuredSystem.config.name,
      solution: {
        state: [0, 0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [],
      },
      parameters: [...configuredSystem.config.params],
    }
    const { system, nodeId } = addObject(configuredSystem, eqObject)

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('equilibrium-continuation-toggle'))
    const branchInput = screen.getByTestId('equilibrium-branch-name')
    const paramSelect = screen.getByTestId('equilibrium-branch-parameter')

    await waitFor(() => {
      expect(branchInput).toHaveValue('Eq_Param_alpha')
    })

    await user.selectOptions(paramSelect, 'gamma')

    await waitFor(() => {
      expect(branchInput).toHaveValue('Eq_Param_gamma')
    })
  })

  it('preserves edited equilibrium continuation names when the parameter changes', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Eq_Param_Edit_System' })
    const configuredSystem = {
      ...baseSystem,
      config: {
        ...baseSystem.config,
        paramNames: ['alpha', 'gamma'],
        params: [0.1, 0.2],
      },
    }
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq Param',
      systemName: configuredSystem.config.name,
      solution: {
        state: [0, 0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [],
      },
      parameters: [...configuredSystem.config.params],
    }
    const { system, nodeId } = addObject(configuredSystem, eqObject)

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('equilibrium-continuation-toggle'))
    const branchInput = screen.getByTestId('equilibrium-branch-name')
    const paramSelect = screen.getByTestId('equilibrium-branch-parameter')

    await waitFor(() => {
      expect(branchInput).toHaveValue('Eq_Param_alpha')
    })

    await user.clear(branchInput)
    await user.type(branchInput, 'custom_branch')

    await user.selectOptions(paramSelect, 'gamma')

    await waitFor(() => {
      expect(branchInput).toHaveValue('custom_branch')
    })
  })

  it('suggests cli-safe branch names when continuing from a branch point', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Branch_Continue_System' })
    const configuredSystem = {
      ...baseSystem,
      config: {
        ...baseSystem.config,
        paramNames: ['mu beta', 'kappa'],
        params: [0.2, 0.3],
      },
    }
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq Branch',
      systemName: configuredSystem.config.name,
      parameters: [...configuredSystem.config.params],
      solution: {
        state: [0, 0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [],
      },
    }
    const added = addObject(configuredSystem, eqObject)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq branch',
      systemName: configuredSystem.config.name,
      parameterName: 'mu beta',
      parentObject: eqObject.name,
      startObject: eqObject.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0, 0],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
      },
      settings: {
        step_size: 0.02,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 40,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...configuredSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-continue-toggle'))
    const branchInput = screen.getByTestId('branch-from-point-name')

    await waitFor(() => {
      expect(branchInput).toHaveValue('eq_branch_mu_beta')
    })
  })

  it('submits "Continue from Point" requests for flow limit-cycle branches', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'LC_Continue_From_Point',
      config: {
        name: 'LC_Continue_From_Point',
        equations: ['y', '-x'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Seed',
      systemName: baseSystem.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Seed' },
      ntst: 4,
      ncol: 2,
      period: 6,
      state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
      createdAt: new Date().toISOString(),
    }
    const added = addObject(baseSystem, limitCycle)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_seed_mu',
      systemName: baseSystem.config.name,
      parameterName: 'mu',
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 4, ncol: 2 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...baseSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const onCreateBranchFromPoint = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={onCreateBranchFromPoint}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-continue-toggle'))
    await user.clear(screen.getByTestId('branch-from-point-name'))
    await user.type(screen.getByTestId('branch-from-point-name'), 'lc_restart_mu')
    await user.click(screen.getByTestId('branch-from-point-submit'))

    expect(onCreateBranchFromPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'lc_restart_mu',
        parameterName: 'mu',
      })
    )
  })

  it('shows and submits "Continue Isochrone" for limit-cycle branches', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'Isochrone_Menu_System',
      config: {
        name: 'Isochrone_Menu_System',
        equations: ['y', '-x + mu + nu'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Isochrone',
      systemName: baseSystem.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Isochrone' },
      ntst: 4,
      ncol: 2,
      period: 6,
      state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
      parameters: [...baseSystem.config.params],
      parameterName: 'mu',
      paramValue: 0.2,
      createdAt: new Date().toISOString(),
    }
    const added = addObject(baseSystem, limitCycle)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_isochrone_seed_mu',
      systemName: baseSystem.config.name,
      parameterName: 'mu',
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 4, ncol: 2 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...baseSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const onCreateIsochroneCurveFromPoint = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateIsochroneCurveFromPoint={onCreateIsochroneCurveFromPoint}
      />
    )

    await user.click(screen.getByTestId('isochrone-curve-toggle'))
    await user.clear(screen.getByTestId('isochrone-curve-name'))
    await user.type(screen.getByTestId('isochrone-curve-name'), 'iso_curve_nu_mu')
    expect(screen.getByTestId('isochrone-curve-param1')).toHaveValue('mu')
    await user.selectOptions(screen.getByTestId('isochrone-curve-param1'), 'nu')
    await user.selectOptions(screen.getByTestId('isochrone-curve-param2'), 'mu')
    await user.selectOptions(screen.getByTestId('isochrone-curve-direction'), 'backward')
    await user.click(screen.getByTestId('isochrone-curve-submit'))

    expect(onCreateIsochroneCurveFromPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'iso_curve_nu_mu',
        parameterName: 'nu',
        param2Name: 'mu',
        forward: false,
      })
    )
  })

  it('shows "Continue from Point" for isochrone branches and submits continuation', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'Isochrone_From_Isochrone_Menu_System',
      config: {
        name: 'Isochrone_From_Isochrone_Menu_System',
        equations: ['y', '-x + mu + nu + kappa'],
        params: [0.2, 0.1, 0.3],
        paramNames: ['mu', 'nu', 'kappa'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Isochrone_Source',
      systemName: baseSystem.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Isochrone_Source' },
      ntst: 1,
      ncol: 1,
      period: 6,
      state: [0.2, 0.3, 0.2, 0.3, 6],
      parameters: [...baseSystem.config.params],
      parameterName: 'mu',
      paramValue: 0.2,
      createdAt: new Date().toISOString(),
    }
    const added = addObject(baseSystem, limitCycle)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'isochrone_seed_mu_nu',
      systemName: baseSystem.config.name,
      parameterName: 'mu, nu',
      parentObject: limitCycle.name,
      startObject: 'lc_iso_seed',
      branchType: 'isochrone_curve',
      data: {
        points: [
          {
            state: [0.5, -0.1, 0.2, 0.3, 0.2, 0.3, 6],
            param_value: 0.25,
            param2_value: 0.35,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'IsochroneCurve',
          param1_name: 'mu',
          param2_name: 'nu',
          ntst: 1,
          ncol: 1,
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...baseSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const onCreateIsochroneCurveFromPoint = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateIsochroneCurveFromPoint={onCreateIsochroneCurveFromPoint}
      />
    )

    expect(screen.getByTestId('isochrone-curve-toggle')).toHaveTextContent('Continue from Point')
    await user.click(screen.getByTestId('isochrone-curve-toggle'))
    await user.clear(screen.getByTestId('isochrone-curve-name'))
    await user.type(screen.getByTestId('isochrone-curve-name'), 'iso_curve_kappa_mu')
    expect(screen.getByTestId('isochrone-curve-param1')).toHaveValue('mu')
    await user.selectOptions(screen.getByTestId('isochrone-curve-param1'), 'kappa')
    await user.selectOptions(screen.getByTestId('isochrone-curve-param2'), 'mu')
    await user.click(screen.getByTestId('isochrone-curve-submit'))

    expect(onCreateIsochroneCurveFromPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'iso_curve_kappa_mu',
        parameterName: 'kappa',
        param2Name: 'mu',
      })
    )
  })

  it('hides "Continue Isochrone" outside limit-cycle branch context', () => {
    const baseSystem = createSystem({ name: 'Isochrone_Hidden_System' })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Isochrone_Hidden',
      systemName: baseSystem.config.name,
      solution: {
        state: [0, 0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [],
      },
      parameters: [...baseSystem.config.params],
    }
    const added = addObject(baseSystem, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_hidden_mu',
      systemName: baseSystem.config.name,
      parameterName: baseSystem.config.paramNames[0] ?? 'mu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0, 0],
            param_value: baseSystem.config.params[0] ?? 0,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...baseSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateIsochroneCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.queryByTestId('isochrone-curve-toggle')).toBeNull()
  })

  it('labels limit cycle point details as Floquet Multipliers', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'LC_Label_System' })
    const configuredSystem = {
      ...baseSystem,
      config: {
        ...baseSystem.config,
        paramNames: ['mu'],
        params: [0.2],
      },
    }
    const lcObject: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC Label',
      systemName: configuredSystem.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit Label' },
      ntst: 20,
      ncol: 4,
      period: 6,
      state: [0.1, 0.2, 6],
      parameters: [...configuredSystem.config.params],
      parameterName: 'mu',
      paramValue: 0.2,
      createdAt: new Date().toISOString(),
    }
    const added = addObject(configuredSystem, lcObject)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_label_mu',
      systemName: configuredSystem.config.name,
      parameterName: 'mu',
      parentObject: lcObject.name,
      startObject: lcObject.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0.1, 0.2, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [{ re: 0.5, im: 0.2 }],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 20, ncol: 4 },
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 50,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...configuredSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.getByText('Branch Summary')).toBeVisible()
    expect(screen.getByText('Branch Navigator')).toBeVisible()
    expect(screen.getByText('Point Details')).toBeVisible()

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-point-details-toggle'))

    expect(screen.getByText('Amplitude (min to max)')).toBeVisible()
    expect(screen.getByText('Mean & RMS')).toBeVisible()
    expect(screen.getByText('Floquet Multipliers')).toBeVisible()
    expect(screen.getByTestId('branch-eigenvalue-plot')).toBeVisible()
  })

  it('sets limit cycle render targets from the cycle navigator', async () => {
    const user = userEvent.setup()
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }
    const onSetLimitCycleRenderTarget = vi.fn()

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={branchId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onSetLimitCycleRenderTarget={onSetLimitCycleRenderTarget}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    const button = await screen.findByTestId('branch-point-render-lc')
    await user.click(button)

    expect(onSetLimitCycleRenderTarget).toHaveBeenCalledWith(limitCycleId, {
      type: 'branch',
      branchId,
      pointIndex: 0,
    })
  })

  it('shows manifold solver diagnostics for 2D manifold branches', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Manifold_Diagnostics',
      equations: ['sigma*(y-x)', 'x*(rho-z)-y', 'x*y-beta*z'],
      params: [10, 28, 8 / 3],
      paramNames: ['sigma', 'rho', 'beta'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    const baseSystem = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq0',
      systemName: config.name,
    }
    const withEq = addObject(baseSystem, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq0_ws_2d',
      systemName: config.name,
      parameterName: 'arclength',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_2d',
      data: {
        points: [
          {
            state: [0, 0, 0],
            param_value: 0,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'ManifoldEq2D',
          stability: 'Stable',
          eig_kind: 'RealPair',
          eig_indices: [0, 1],
          method: 'leaf_shooting_bvp',
          caps: {
            max_steps: 2000,
            max_points: 20000,
            max_rings: 500,
            max_vertices: 200000,
            max_time: 100,
          },
        },
        manifold_geometry: {
          type: 'Surface',
          dim: 3,
          vertices_flat: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          triangles: [0, 1, 2],
          ring_offsets: [0],
          ring_diagnostics: [{ ring_index: 1, radius_estimate: 0.1, point_count: 20 }],
          solver_diagnostics: {
            termination_reason: 'ring_build_failed',
            termination_detail:
              'ring=8 attempt=0 delta=0.025: could not solve all leaf points',
            final_leaf_delta: 0.025,
            ring_attempts: 9,
            build_failures: 1,
            spacing_failures: 0,
            reject_ring_quality: 3,
            reject_geodesic_quality: 2,
            reject_too_small: 0,
            failed_ring: 9,
            failed_attempt: 1,
            failed_leaf_points: 17,
            leaf_delta_floor: 1e-6,
            min_leaf_delta_reached: true,
            last_ring_max_turn_angle: 0.4,
            last_ring_max_distance_angle: 0.03,
            last_geodesic_max_angle: 0.7,
            last_geodesic_max_distance_angle: 0.08,
          },
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...config.params],
    }
    const withBranch = addBranch(withEq.system, branch, withEq.nodeId)

    render(
      <InspectorDetailsPanel
        system={withBranch.system}
        selectedNodeId={withBranch.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.getByText('Branch Summary')).toBeVisible()
    await user.click(screen.getByTestId('branch-summary-toggle'))
    expect(screen.getByText('Manifold solver diagnostics')).toBeVisible()
    expect(screen.getByText('Ring Build Failed')).toBeVisible()
    expect(screen.getByText('Leaf delta floor')).toBeVisible()
    expect(screen.getByText('Failed ring')).toBeVisible()
    expect(screen.getByText('Failed attempt')).toBeVisible()
    expect(screen.getByText('Solved leaf points before fail')).toBeVisible()
    expect(
      screen.getByText('ring=8 attempt=0 delta=0.025: could not solve all leaf points')
    ).toBeVisible()
  })

  it('allows setting limit cycle render targets from homoclinic child branches', async () => {
    const user = userEvent.setup()
    let system = createSystem({
      name: 'LC_Homoc_Render_Target',
      config: {
        name: 'LC_Homoc_Render_Target',
        equations: ['y', '-x'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })

    const lcObject: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_A',
      systemName: system.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_A' },
      ntst: 2,
      ncol: 1,
      period: 1,
      state: [0, 0, 1, 0, 2, 0, 0.5, 0, 1.5, 0, 1],
      createdAt: new Date().toISOString(),
    }
    const addedObject = addObject(system, lcObject)
    system = addedObject.system

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
        bifurcations: [0],
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
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const addedBranch = addBranch(system, homocBranch, addedObject.nodeId)
    const onSetLimitCycleRenderTarget = vi.fn()

    render(
      <InspectorDetailsPanel
        system={addedBranch.system}
        selectedNodeId={addedBranch.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onSetLimitCycleRenderTarget={onSetLimitCycleRenderTarget}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    const button = await screen.findByTestId('branch-point-render-lc')
    await user.click(button)

    expect(onSetLimitCycleRenderTarget).toHaveBeenCalledWith(addedObject.nodeId, {
      type: 'branch',
      branchId: addedBranch.nodeId,
      pointIndex: 0,
    })
  })

  it('shows homoclinic point state as equilibrium coordinates in point details', async () => {
    const user = userEvent.setup()
    const base = createSystem({
      name: 'Homoc_State_Details',
      config: {
        name: 'Homoc_State_Details',
        equations: ['y', '-x'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_seed',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: [
              // mesh + stage
              12, 34, 13, 35, 14, 36, 12.5, 34.5, 13.5, 35.5,
              // x0 + p2 + extras/tail
              1.25, -0.75, 0.11, 8, 0.02, 0, 0,
            ],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [{ re: -0.1, im: 0.7 }, { re: -0.1, im: -0.7 }],
          },
        ],
        bifurcations: [0],
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
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))
    await user.click(screen.getByTestId('branch-point-details-toggle'))

    const details = screen.getByTestId('branch-point-details-toggle').closest('details')
    if (!details) {
      throw new Error('Missing point details disclosure.')
    }
    const detailsScope = within(details)
    const xRow = detailsScope.getByText('x').closest('.inspector-metrics__row')
    const yRow = detailsScope.getByText('y').closest('.inspector-metrics__row')
    expect(xRow).toBeTruthy()
    expect(yRow).toBeTruthy()
    expect(xRow?.querySelector('.inspector-metrics__value')?.textContent).toBe('1.25000')
    expect(yRow?.querySelector('.inspector-metrics__value')?.textContent).toBe('-0.750000')
    expect(detailsScope.getByTestId('branch-eigenvalue-plot')).toBeVisible()
  })

  it('displays continued frozen-variable values per branch point in state details', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Frozen_Var_Display',
      equations: ['y', 'x - z', '0.1 * (x - z)'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    let system = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Frozen',
      systemName: config.name,
      solution: {
        state: [0.2, 0.1, -1.5],
        residual_norm: 0,
        iterations: 0,
        jacobian: [],
        eigenpairs: [],
      },
      frozenVariables: { frozenValuesByVarName: { x: 0.2, z: -1.5 } },
      subsystemSnapshot: buildSubsystemSnapshot(config, {
        frozenValuesByVarName: { x: 0.2, z: -1.5 },
      }),
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
            stability: 'Stable',
            eigenvalues: [],
          },
          {
            state: [0.3],
            param_value: 0.55,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0, 1],
        indices: [-1, 0],
        branch_type: { type: 'Equilibrium' },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...config.params],
      subsystemSnapshot: equilibrium.subsystemSnapshot,
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-point-details-toggle'))

    const details = screen.getByTestId('branch-point-details-toggle').closest('details')
    if (!details) throw new Error('Missing point details disclosure.')
    const detailsScope = within(details)

    const readStateValues = () => {
      const findStateRow = (label: string) =>
        detailsScope
          .getAllByText(label)
          .map((entry) => entry.closest('.inspector-metrics__row'))
          .find((row) => {
            const valueText = row?.querySelector('.inspector-metrics__value')?.textContent ?? ''
            return !valueText.includes('to') && !valueText.includes('mean')
          })
      const xRow = findStateRow('x*')
      const yRow = findStateRow('y')
      const zRow = findStateRow('z*')
      return {
        x: xRow?.querySelector('.inspector-metrics__value')?.textContent,
        y: yRow?.querySelector('.inspector-metrics__value')?.textContent,
        z: zRow?.querySelector('.inspector-metrics__value')?.textContent,
      }
    }

    await waitFor(() => {
      const values = readStateValues()
      expect(values.x).toBe('0.250000')
      expect(values.y).toBe('0.100000')
      expect(values.z).toBe('-1.50000')
    })

    await user.click(screen.getByTestId('branch-bifurcation-1'))
    await waitFor(() => {
      const values = readStateValues()
      expect(values.x).toBe('0.550000')
      expect(values.y).toBe('0.300000')
      expect(values.z).toBe('-1.50000')
    })
  })

  it('embeds reduced limit-cycle branch points with frozen-variable overrides in state details', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Frozen_LC_Inspector',
      equations: ['y', '-y', '0'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    let system = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed',
      systemName: config.name,
      solution: {
        state: [0, 0, 2.2],
        residual_norm: 0,
        iterations: 0,
        jacobian: [],
        eigenpairs: [],
      },
      frozenVariables: { frozenValuesByVarName: { x: 0, z: 2.2 } },
      subsystemSnapshot: buildSubsystemSnapshot(config, {
        frozenValuesByVarName: { x: 0, z: 2.2 },
      }),
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_frozen_branch',
      systemName: config.name,
      parameterName: 'var:x',
      parameterRef: { kind: 'frozen_var', variableName: 'x' },
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          { state: [1.5, 1.8, 9], param_value: 0.3, stability: 'None', eigenvalues: [] },
          { state: [2.5, 2.9, 9], param_value: 0.5, stability: 'None', eigenvalues: [] },
        ],
        bifurcations: [0, 1],
        indices: [0, 1],
        branch_type: { type: 'LimitCycle', ntst: 1, ncol: 1 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...config.params],
      subsystemSnapshot: equilibrium.subsystemSnapshot,
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)
    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-point-details-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))

    const details = screen.getByTestId('branch-point-details-toggle').closest('details')
    if (!details) throw new Error('Missing point details disclosure.')
    const detailsScope = within(details)

    await waitFor(() => {
      expect(detailsScope.getByText('0.300000 to 0.300000 (0.00000)')).toBeVisible()
      expect(detailsScope.getByText('1.50000 to 1.80000 (0.300000)')).toBeVisible()
      expect(detailsScope.getByText('2.20000 to 2.20000 (0.00000)')).toBeVisible()
    })

    await user.click(screen.getByTestId('branch-bifurcation-1'))
    await waitFor(() => {
      expect(detailsScope.getByText('0.500000 to 0.500000 (0.00000)')).toBeVisible()
      expect(detailsScope.getByText('2.50000 to 2.90000 (0.400000)')).toBeVisible()
      expect(detailsScope.getByText('2.20000 to 2.20000 (0.00000)')).toBeVisible()
    })
  })

  it('shows cycle point table for discrete map branch points', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Map_System',
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
      },
    }
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'CycleBranch',
      systemName: config.name,
      parameterName: 'r',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0.3],
            param_value: 2.5,
            stability: 'None',
            cycle_points: [
              [0.3],
              [0.9],
            ],
          },
        ],
        bifurcations: [],
        indices: [0],
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 10,
        corrector_steps: 3,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...config.params],
    }
    const branchResult = addBranch(system, branch, equilibriumResult.nodeId)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-point-details-toggle'))

    const cycleTable = screen.getByRole('region', { name: 'Cycle point data' })
    expect(cycleTable).toBeVisible()
    const rows = within(cycleTable).getAllByRole('row')
    const cyclePoints = branch.data.points[0].cycle_points ?? []
    expect(rows).toHaveLength(1 + cyclePoints.length)
    expect(within(cycleTable).getByText('0.3000')).toBeVisible()
    expect(within(cycleTable).getByText('0.9000')).toBeVisible()
  })

  it('keeps the selected cycle navigator point after rendering a limit cycle', async () => {
    const user = userEvent.setup()
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }

    function Wrapper() {
      const [state, setState] = useState(system)
      return (
        <InspectorDetailsPanel
          system={state}
          selectedNodeId={branchId}
          view="selection"
          theme="light"
          onRename={vi.fn()}
          onToggleVisibility={vi.fn()}
          onUpdateRender={vi.fn()}
          onUpdateScene={vi.fn()}
          onUpdateBifurcationDiagram={vi.fn()}
          onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
          onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
          onRunOrbit={vi.fn().mockResolvedValue(undefined)}
          onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
          onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
          onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
          onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
          onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
          onExtendBranch={vi.fn().mockResolvedValue(undefined)}
          onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
          onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
          onSetLimitCycleRenderTarget={(objectId, target) => {
            setState((prev) => updateLimitCycleRenderTarget(prev, objectId, target))
          }}
        />
      )
    }

    render(<Wrapper />)

    await user.click(screen.getByTestId('branch-points-toggle'))
    const input = screen.getByTestId('branch-point-input')
    await user.clear(input)
    await user.type(input, '1')
    await user.click(screen.getByTestId('branch-point-jump'))

    expect(screen.getByText('Selected point: 1 ([1] memaddr)')).toBeVisible()

    const button = screen.getByTestId('branch-point-render-lc')
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByText('Selected point: 1 ([1] memaddr)')).toBeVisible()
    })
    await waitFor(() => {
      expect(screen.queryByTestId('branch-point-render-lc')).toBeNull()
    })
  })

  it('hides the render button when the selected point is already rendered', async () => {
    const user = userEvent.setup()
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }
    system.ui.limitCycleRenderTargets = {
      [limitCycleId]: { type: 'branch', branchId, pointIndex: 0 },
    }

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={branchId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onSetLimitCycleRenderTarget={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    expect(screen.queryByTestId('branch-point-render-lc')).toBeNull()
  })

  it('shows the render source for limit cycle objects', () => {
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }
    system.ui.limitCycleRenderTargets = {
      [limitCycleId]: { type: 'branch', branchId, pointIndex: 1 },
    }

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={limitCycleId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onSetLimitCycleRenderTarget={vi.fn()}
      />
    )

    expect(screen.getByText('Rendered at')).toBeVisible()
    expect(screen.getByText('lc_pd_mu @ 1')).toBeVisible()
  })

  it('uses render target parameters for limit cycle inspector data', async () => {
    const user = userEvent.setup()
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }

    const limitCycle = system.objects[limitCycleId] as LimitCycleObject
    system.objects[limitCycleId] = {
      ...limitCycle,
      parameters: [9],
      paramValue: 9,
      floquetMultipliers: [{ re: 0.1, im: 0.2 }],
    }
    system.ui.limitCycleRenderTargets = {
      [limitCycleId]: { type: 'branch', branchId, pointIndex: 1 },
    }

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={limitCycleId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onSetLimitCycleRenderTarget={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('limit-cycle-data-toggle'))

    expect(screen.getAllByText('0.250000')[0]).toBeVisible()
    expect(screen.queryByText('9.00000')).toBeNull()
    expect(screen.getByText('-1.0000 + 0.0000i')).toBeVisible()
    expect(screen.queryByText('0.1000 + 0.2000i')).toBeNull()
  })

  it('uses stored Floquet mode multipliers when mode vectors are present', async () => {
    const user = userEvent.setup()
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }

    const limitCycle = system.objects[limitCycleId] as LimitCycleObject
    system.objects[limitCycleId] = {
      ...limitCycle,
      floquetMultipliers: [{ re: 0.1, im: 0.2 }],
      floquetModes: {
        ntst: limitCycle.ntst,
        ncol: limitCycle.ncol,
        multipliers: [{ re: 0.3, im: 0 }],
        vectors: [
          [
            [
              { re: 1, im: 0 },
              { re: 0, im: 0 },
            ],
          ],
        ],
        computedAt: new Date().toISOString(),
      },
    }
    system.ui.limitCycleRenderTargets = {
      [limitCycleId]: { type: 'branch', branchId, pointIndex: 1 },
    }

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={limitCycleId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onSetLimitCycleRenderTarget={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('limit-cycle-data-toggle'))

    expect(screen.getByText('0.3000 + 0.0000i')).toBeVisible()
    expect(screen.queryByText('-1.0000 + 0.0000i')).toBeNull()
  })

  it('shows and runs manual Floquet mode compute even before multipliers exist', async () => {
    const user = userEvent.setup()
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }
    const limitCycle = system.objects[limitCycleId] as LimitCycleObject
    system.objects[limitCycleId] = {
      ...limitCycle,
      floquetMultipliers: [],
      floquetModes: undefined,
    }
    const onComputeLimitCycleFloquetModes = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={limitCycleId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onComputeLimitCycleFloquetModes={onComputeLimitCycleFloquetModes}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onSetLimitCycleRenderTarget={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('limit-cycle-data-toggle'))
    expect(screen.getByText('Floquet multipliers not computed yet.')).toBeVisible()

    const computeButton = screen.getByTestId('limit-cycle-floquet-modes-compute')
    expect(computeButton).toBeEnabled()
    await user.click(computeButton)

    expect(onComputeLimitCycleFloquetModes).toHaveBeenCalledWith({ limitCycleId })
  })

  it('shows a toggle for the trivial Floquet mode (index 0)', async () => {
    const user = userEvent.setup()
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }

    const limitCycle = system.objects[limitCycleId] as LimitCycleObject
    system.objects[limitCycleId] = {
      ...limitCycle,
      floquetMultipliers: [
        { re: 1, im: 0 },
        { re: 0.5, im: 0 },
      ],
      floquetModes: {
        ntst: limitCycle.ntst,
        ncol: limitCycle.ncol,
        multipliers: [
          { re: 1, im: 0 },
          { re: 0.5, im: 0 },
        ],
        vectors: [
          [
            [
              { re: 1, im: 0 },
              { re: 0, im: 0 },
            ],
            [
              { re: 0, im: 0 },
              { re: 1, im: 0 },
            ],
          ],
        ],
        computedAt: new Date().toISOString(),
      },
    }

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={limitCycleId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onSetLimitCycleRenderTarget={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('limit-cycle-data-toggle'))
    expect(screen.getByTestId('limit-cycle-floquet-show-0')).toBeVisible()
  })

  it('allows restoring the stored limit cycle render target for orbit-sourced cycles', async () => {
    const user = userEvent.setup()
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }
    system.ui.limitCycleRenderTargets = {
      [limitCycleId]: { type: 'branch', branchId, pointIndex: 1 },
    }
    const onSetLimitCycleRenderTarget = vi.fn()

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={limitCycleId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onSetLimitCycleRenderTarget={onSetLimitCycleRenderTarget}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const button = screen.getByTestId('limit-cycle-render-stored')
    expect(button).toHaveTextContent('Render @ original parameters')
    await user.click(button)
    expect(onSetLimitCycleRenderTarget).toHaveBeenCalledWith(limitCycleId, {
      type: 'object',
    })
  })

  it('hides the restore button when the stored cycle is already rendered', () => {
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }
    system.ui.limitCycleRenderTargets = {
      [limitCycleId]: { type: 'object' },
    }

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={limitCycleId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onSetLimitCycleRenderTarget={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.queryByTestId('limit-cycle-render-stored')).toBeNull()
    expect(screen.getByText('Stored cycle')).toBeVisible()
  })

  it('branches to period-doubled limit cycles', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'PD_System' })
    const configuredSystem = {
      ...baseSystem,
      config: {
        ...baseSystem.config,
        paramNames: ['mu'],
        params: [0.2],
      },
    }
    const lcObject: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_PD',
      systemName: configuredSystem.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit PD' },
      ntst: 20,
      ncol: 4,
      period: 6,
      state: [0.1, 0.2, 6],
      parameters: [...configuredSystem.config.params],
      parameterName: 'mu',
      paramValue: 0.2,
      createdAt: new Date().toISOString(),
    }
    const added = addObject(configuredSystem, lcObject)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_pd_mu',
      systemName: configuredSystem.config.name,
      parameterName: 'mu',
      parentObject: lcObject.name,
      startObject: lcObject.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0.1, 0.2, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [0.1, 0.2, 6],
            param_value: 0.25,
            stability: 'PeriodDoubling',
            eigenvalues: [{ re: -1, im: 0 }],
          },
        ],
        bifurcations: [1],
        indices: [1, 0],
        branch_type: { type: 'LimitCycle', ntst: 20, ncol: 4 },
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 50,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...configuredSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const onCreateLimitCycleFromPD = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={onCreateLimitCycleFromPD}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-1'))
    await user.click(screen.getByTestId('limit-cycle-from-pd-toggle'))
    await user.clear(screen.getByTestId('limit-cycle-from-pd-name'))
    await user.type(screen.getByTestId('limit-cycle-from-pd-name'), 'lc_pd')
    await user.clear(screen.getByTestId('limit-cycle-from-pd-branch-name'))
    await user.type(screen.getByTestId('limit-cycle-from-pd-branch-name'), 'lc_pd_branch')
    await user.clear(screen.getByTestId('limit-cycle-from-pd-amplitude'))
    await user.type(screen.getByTestId('limit-cycle-from-pd-amplitude'), '0.01')
    await user.clear(screen.getByTestId('limit-cycle-from-pd-ncol'))
    await user.type(screen.getByTestId('limit-cycle-from-pd-ncol'), '4')
    await user.selectOptions(
      screen.getByTestId('limit-cycle-from-pd-direction'),
      'forward'
    )
    await user.clear(screen.getByTestId('limit-cycle-from-pd-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-pd-step-size'), '0.01')
    await user.clear(screen.getByTestId('limit-cycle-from-pd-max-steps'))
    await user.type(screen.getByTestId('limit-cycle-from-pd-max-steps'), '50')
    await user.clear(screen.getByTestId('limit-cycle-from-pd-min-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-pd-min-step-size'), '1e-5')
    await user.clear(screen.getByTestId('limit-cycle-from-pd-max-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-pd-max-step-size'), '0.1')
    await user.clear(screen.getByTestId('limit-cycle-from-pd-corrector-steps'))
    await user.type(screen.getByTestId('limit-cycle-from-pd-corrector-steps'), '10')
    await user.clear(screen.getByTestId('limit-cycle-from-pd-corrector-tolerance'))
    await user.type(screen.getByTestId('limit-cycle-from-pd-corrector-tolerance'), '1e-6')
    await user.clear(screen.getByTestId('limit-cycle-from-pd-step-tolerance'))
    await user.type(screen.getByTestId('limit-cycle-from-pd-step-tolerance'), '1e-6')
    await user.click(screen.getByTestId('limit-cycle-from-pd-submit'))

    expect(onCreateLimitCycleFromPD).toHaveBeenCalledWith({
      branchId: branchResult.nodeId,
      pointIndex: 1,
      limitCycleName: 'lc_pd',
      branchName: 'lc_pd_branch',
      amplitude: 0.01,
      ncol: 4,
      settings: {
        step_size: 0.01,
        max_steps: 50,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        corrector_steps: 10,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      forward: true,
    })
  }, 15_000)

  it('hides NCOL for period-doubling continuation in maps', async () => {
    // TODO: This map-vs-flow UI gating is a brittle design pattern; revisit with a holistic menu model.
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'PD_Map',
      config: {
        name: 'PD_Map',
        equations: ['x'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['x'],
        solver: 'discrete',
        type: 'map',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_PD',
      systemName: baseSystem.config.name,
    }
    const added = addObject(baseSystem, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_pd_mu',
      systemName: baseSystem.config.name,
      parameterName: 'mu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0.1],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [0.1],
            param_value: 0.25,
            stability: 'PeriodDoubling',
            eigenvalues: [{ re: -1, im: 0 }],
          },
        ],
        bifurcations: [1],
        indices: [1, 0],
        branch_type: { type: 'Equilibrium' },
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 50,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...baseSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-1'))
    await user.click(screen.getByTestId('limit-cycle-from-pd-toggle'))

    expect(screen.getByTestId('limit-cycle-from-pd-name')).toBeVisible()
    expect(screen.queryByTestId('limit-cycle-from-pd-ncol')).toBeNull()
  })

  it('shows codim-1 NS continuation only for Neimark-Sacker points in maps', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'NS_Map',
      config: {
        name: 'NS_Map',
        equations: ['x'],
        params: [0.2, 0.3],
        paramNames: ['mu', 'nu'],
        varNames: ['x'],
        solver: 'discrete',
        type: 'map',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_NS',
      systemName: baseSystem.config.name,
    }
    const added = addObject(baseSystem, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_ns',
      systemName: baseSystem.config.name,
      parameterName: 'mu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0.1],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [0.1],
            param_value: 0.25,
            stability: 'NeimarkSacker',
            eigenvalues: [],
          },
        ],
        bifurcations: [1],
        indices: [1, 0],
        branch_type: { type: 'Equilibrium' },
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 50,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...baseSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.queryByTestId('codim1-curve-toggle')).toBeNull()

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-1'))

    const codimToggle = await screen.findByTestId('codim1-curve-toggle')
    expect(codimToggle).toBeVisible()
    await user.click(codimToggle)
    expect(screen.getByText('Neimark-Sacker curve')).toBeVisible()
  })

  it('renders flow limit cycle menu titles for equilibrium branches', () => {
    const config: SystemConfig = {
      name: 'Flow_Menu',
      equations: ['x', '-x'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow',
    }
    const baseSystem = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Flow',
      systemName: config.name,
    }
    const added = addObject(baseSystem, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_flow_mu',
      systemName: config.name,
      parameterName: 'mu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0.1, 0.2],
            param_value: 0.2,
            stability: 'Hopf',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: { type: 'Equilibrium' },
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 50,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.getByTestId('limit-cycle-from-hopf-toggle')).toHaveTextContent(
      'Limit Cycle from Hopf'
    )
    expect(screen.queryByTestId('limit-cycle-from-pd-toggle')).toBeNull()
    expect(screen.queryByText('Cycle from NS')).toBeNull()
    expect(screen.queryByText('Cycle from PD')).toBeNull()
  })

  it('shows "Limit Cycle from Hopf" guidance for non-Hopf equilibrium points', () => {
    const config: SystemConfig = {
      name: 'Flow_Menu_No_Hopf',
      equations: ['x', '-x'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow',
    }
    const baseSystem = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Flow_No_Hopf',
      systemName: config.name,
    }
    const added = addObject(baseSystem, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_flow_no_hopf_mu',
      systemName: config.name,
      parameterName: 'mu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0.1, 0.2],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: { type: 'Equilibrium' },
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 50,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const hopfToggle = screen.getByTestId('limit-cycle-from-hopf-toggle')
    fireEvent.click(hopfToggle)
    expect(
      screen.getByText('Select a Hopf bifurcation point to continue a limit cycle.')
    ).toBeInTheDocument()
  })

  it('hides "Limit Cycle from Hopf" for limit-cycle and homoclinic branches', () => {
    const config: SystemConfig = {
      name: 'Flow_Menu_Non_Hopf_Branches',
      equations: ['x', '-x'],
      params: [0.2, 0.1],
      paramNames: ['mu', 'nu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow',
    }
    const baseSystem = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Flow_Non_Hopf_Branches',
      systemName: config.name,
    }
    const withEq = addObject(baseSystem, equilibrium)
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Flow_Non_Hopf',
      systemName: config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Flow_Non_Hopf' },
      ntst: 4,
      ncol: 2,
      period: 6,
      state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
      createdAt: new Date().toISOString(),
    }
    const withLc = addObject(withEq.system, limitCycle)
    const limitCycleBranch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_flow_mu',
      systemName: config.name,
      parameterName: 'mu',
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 4, ncol: 2 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...config.params],
    }
    const lcBranchResult = addBranch(withLc.system, limitCycleBranch, withLc.nodeId)
    const homoclinicBranch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_flow_mu_nu',
      systemName: config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: new Array(80).fill(0),
            param_value: 0.2,
            param2_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 6,
          ncol: 2,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: true,
          free_eps0: true,
          free_eps1: true,
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...config.params],
    }
    const homocBranchResult = addBranch(
      lcBranchResult.system,
      homoclinicBranch,
      withEq.nodeId
    )

    const rendered = render(
      <InspectorDetailsPanel
        system={homocBranchResult.system}
        selectedNodeId={lcBranchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )
    expect(screen.queryByTestId('limit-cycle-from-hopf-toggle')).toBeNull()

    rendered.rerender(
      <InspectorDetailsPanel
        system={homocBranchResult.system}
        selectedNodeId={homocBranchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )
    expect(screen.queryByTestId('limit-cycle-from-hopf-toggle')).toBeNull()
  })

  it('renders map cycle menu titles for equilibrium branches', () => {
    const config: SystemConfig = {
      name: 'Map_Menu',
      equations: ['r * x * (1 - x)'],
      params: [2.5],
      paramNames: ['r'],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map',
    }
    const baseSystem = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Map',
      systemName: config.name,
    }
    const added = addObject(baseSystem, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_map_r',
      systemName: config.name,
      parameterName: 'r',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0.1],
            param_value: 2.5,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: { type: 'Equilibrium' },
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 50,
        corrector_steps: 4,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.queryByTestId('limit-cycle-from-hopf-toggle')).toBeNull()
    expect(screen.queryByTestId('limit-cycle-from-pd-toggle')).toBeNull()
    expect(screen.queryByText('Cycle from NS')).toBeNull()
    expect(screen.queryByText('Limit Cycle from Hopf')).toBeNull()
    expect(screen.queryByText('Limit Cycle from PD')).toBeNull()
  })
  it('solves equilibrium requests', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Test_System' })
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ 1',
      systemName: baseSystem.config.name,
      lastSolverParams: {
        initialGuess: baseSystem.config.varNames.map(() => 0),
        maxSteps: 25,
        dampingFactor: 1,
      },
      parameters: [...baseSystem.config.params],
    }
    const { system, nodeId } = addObject(baseSystem, eqObject)
    const onSolveEquilibrium = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={onSolveEquilibrium}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('equilibrium-solver-toggle'))
    await user.clear(screen.getByTestId('equilibrium-solve-steps'))
    await user.type(screen.getByTestId('equilibrium-solve-steps'), '10')
    await user.clear(screen.getByTestId('equilibrium-solve-damping'))
    await user.type(screen.getByTestId('equilibrium-solve-damping'), '0.8')
    await user.clear(screen.getByTestId('equilibrium-solve-guess-0'))
    await user.type(screen.getByTestId('equilibrium-solve-guess-0'), '1')
    await user.clear(screen.getByTestId('equilibrium-solve-guess-1'))
    await user.type(screen.getByTestId('equilibrium-solve-guess-1'), '2')

    await user.click(screen.getByTestId('equilibrium-solve-submit'))

    expect(onSolveEquilibrium).toHaveBeenCalledWith({
      equilibriumId: nodeId,
      initialGuess: [1, 2],
      maxSteps: 10,
      dampingFactor: 0.8,
    })
  })

  it('hides equilibrium eigenvector controls for 1D systems', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'Eigenvector_1D_System',
      config: {
        name: 'Eigenvector_1D_System',
        equations: ['x'],
        params: [],
        paramNames: [],
        varNames: ['x'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ Eigen 1D',
      systemName: baseSystem.config.name,
      solution: {
        state: [0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [
          {
            value: { re: 1, im: 0 },
            vector: [{ re: 1, im: 0 }],
          },
        ],
      },
      parameters: [...baseSystem.config.params],
    }
    const { system, nodeId } = addObject(baseSystem, eqObject)

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('equilibrium-data-toggle'))

    expect(screen.queryByTestId('equilibrium-eigenvector-enabled')).toBeNull()
    expect(screen.queryByTestId('equilibrium-eigenvector-line-length')).toBeNull()
    expect(screen.queryByTestId('equilibrium-eigenvector-disc-radius')).toBeNull()
    expect(screen.queryByText('Eigenvectors not computed yet.')).toBeNull()
    expect(
      screen.queryByText('Eigenvector plotting requires at least two state variables.')
    ).toBeNull()
  })

  it('toggles equilibrium eigenvector plotting', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Eigenvector_System' })
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ Eigen',
      systemName: baseSystem.config.name,
      solution: {
        state: [0, 0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [
          {
            value: { re: 1, im: 0 },
            vector: [
              { re: 1, im: 0 },
              { re: 0, im: 1 },
            ],
          },
          {
            value: { re: -0.5, im: 0.1 },
            vector: [
              { re: 0.2, im: 0 },
              { re: 0.8, im: 0.1 },
            ],
          },
        ],
      },
      parameters: [...baseSystem.config.params],
    }
    const { system, nodeId } = addObject(baseSystem, eqObject)
    const onUpdateRender = vi.fn()

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={onUpdateRender}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('equilibrium-data-toggle'))
    await user.click(screen.getByTestId('equilibrium-eigenvector-enabled'))

    expect(onUpdateRender).toHaveBeenCalledWith(nodeId, {
      equilibriumEigenvectors: expect.objectContaining({ enabled: true, vectorIndices: [0, 1] }),
    })

    fireEvent.change(screen.getByTestId('equilibrium-eigenvector-color-1'), {
      target: { value: '#ff0000' },
    })

    expect(onUpdateRender).toHaveBeenLastCalledWith(nodeId, {
      equilibriumEigenvectors: expect.objectContaining({
        colors: expect.arrayContaining(['#ff0000']),
      }),
    })
  })

  it('colors equilibrium eigenvalue argand markers from eigenspace colors', async () => {
    const user = userEvent.setup()
    const renderPlotMock = vi.mocked(renderPlot)
    renderPlotMock.mockClear()
    const baseSystem = createSystem({ name: 'Eigenvalue_Color_System' })
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ Colors',
      systemName: baseSystem.config.name,
      solution: {
        state: [0, 0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [
          {
            value: { re: -1, im: 0 },
            vector: [
              { re: 1, im: 0 },
              { re: 0, im: 0 },
            ],
          },
          {
            value: { re: 0.2, im: 0.5 },
            vector: [
              { re: 0.2, im: 0.1 },
              { re: 0.8, im: 0.3 },
            ],
          },
          {
            value: { re: 0.2, im: -0.5 },
            vector: [
              { re: 0.2, im: -0.1 },
              { re: 0.8, im: -0.3 },
            ],
          },
        ],
      },
      parameters: [...baseSystem.config.params],
    }
    const { system, nodeId } = addObject(baseSystem, eqObject)

    function Wrapper() {
      const [state, setState] = useState(system)
      return (
        <InspectorDetailsPanel
          system={state}
          selectedNodeId={nodeId}
          view="selection"
          theme="light"
          onRename={vi.fn()}
          onToggleVisibility={vi.fn()}
          onUpdateRender={(id, render) =>
            setState((prev) => updateNodeRender(prev, id, render))
          }
          onUpdateScene={vi.fn()}
          onUpdateBifurcationDiagram={vi.fn()}
          onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
          onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
          onRunOrbit={vi.fn().mockResolvedValue(undefined)}
          onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
          onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
          onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
          onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
          onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
          onExtendBranch={vi.fn().mockResolvedValue(undefined)}
          onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
          onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        />
      )
    }

    render(<Wrapper />)
    await user.click(screen.getByTestId('equilibrium-data-toggle'))

    fireEvent.change(screen.getByTestId('equilibrium-eigenvector-color-1'), {
      target: { value: '#ff0000' },
    })

    await waitFor(() => {
      const equilibriumPlotCall = [...renderPlotMock.mock.calls]
        .reverse()
        .find(
          (call) =>
            (call[0] as HTMLDivElement).getAttribute('data-testid') ===
            'equilibrium-eigenvalue-plot'
        )
      expect(equilibriumPlotCall).toBeTruthy()
      const traces = equilibriumPlotCall?.[1] as Array<{
        mode?: string
        marker?: { color?: unknown }
      }>
      const markerTrace = traces.find((trace) => trace.mode === 'markers')
      expect(markerTrace?.marker?.color).toEqual(['#1f77b4', '#ff0000', '#ff0000'])
    })
  })

  it('filters equilibrium manifold eigen-index dropdowns by selected stability', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'Manifold_Index_Filter_System',
      config: {
        name: 'Manifold_Index_Filter_System',
        equations: ['x', '-y', 'z'],
        params: [0],
        paramNames: ['mu'],
        varNames: ['x', 'y', 'z'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Filter',
      systemName: baseSystem.config.name,
      solution: {
        state: [0, 0, 0],
        residual_norm: 0,
        iterations: 3,
        jacobian: [1, 0, 0, 0, -1, 0, 0, 0, 0.2],
        eigenpairs: [
          { value: { re: 1.2, im: 0 }, vector: [{ re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }] },
          { value: { re: -0.8, im: 0 }, vector: [{ re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 0 }] },
          { value: { re: 0.5, im: 0.7 }, vector: [{ re: 1, im: 0.2 }, { re: 0, im: 0 }, { re: 0, im: 0 }] },
          { value: { re: -0.3, im: -0.4 }, vector: [{ re: 0, im: 0 }, { re: 1, im: 0.4 }, { re: 0, im: 0 }] },
          { value: { re: -2.0, im: 0 }, vector: [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }] },
        ],
      },
    }
    const added = addObject(baseSystem, equilibrium)

    render(
      <InspectorDetailsPanel
        system={added.system}
        selectedNodeId={added.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumManifold1D={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumManifold2D={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateIsochroneCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleManifold2D={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('equilibrium-manifold-toggle'))

    const eigA = screen.getByTestId('equilibrium-manifold-eig-index-a') as HTMLSelectElement
    expect(Array.from(eigA.options).map((option) => option.textContent)).toEqual([
      '2',
      '4',
      '5',
    ])

    await user.selectOptions(screen.getByTestId('equilibrium-manifold-stability'), 'Unstable')
    await waitFor(() => {
      expect(Array.from(eigA.options).map((option) => option.textContent)).toEqual(['1', '3'])
    })

    await user.selectOptions(screen.getByTestId('equilibrium-manifold-mode'), 'curve_1d')
    await user.selectOptions(screen.getByTestId('equilibrium-manifold-stability'), 'Stable')
    const eig1d = screen.getByTestId('equilibrium-manifold-eig-index') as HTMLSelectElement
    expect(Array.from(eig1d.options).map((option) => option.textContent)).toEqual(['2', '5'])
  })

  it('jumps to the newest branch point after extension', async () => {
    const user = userEvent.setup()
    const { system, branchNodeId } = createDemoSystem()
    const baseBranch = system.branches[branchNodeId]
    if (!baseBranch) {
      throw new Error('Expected equilibrium branch fixture data.')
    }

    const seededBranch: ContinuationObject = {
      ...baseBranch,
      data: {
        ...baseBranch.data,
        points: [
          {
            state: [0, 0],
            param_value: 0,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [0.1, 0.1],
            param_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        indices: [0, 1],
      },
    }

    function Wrapper() {
      const [state, setState] = useState(updateBranch(system, branchNodeId, seededBranch))
      return (
        <InspectorDetailsPanel
          system={state}
          selectedNodeId={branchNodeId}
          view="selection"
          theme="light"
          onRename={vi.fn()}
          onToggleVisibility={vi.fn()}
          onUpdateRender={vi.fn()}
          onUpdateScene={vi.fn()}
          onUpdateBifurcationDiagram={vi.fn()}
          onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
          onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
          onRunOrbit={vi.fn().mockResolvedValue(undefined)}
          onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
          onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
          onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
          onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
          onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
          onExtendBranch={async () => {
            setState((prev) => {
              const source = prev.branches[branchNodeId]
              const nextPoints = [
                ...source.data.points,
                {
                  state: [0.2, 0.2],
                  param_value: 0.2,
                  stability: 'None',
                  eigenvalues: [],
                },
              ]
              const nextIndices = [...(source.data.indices ?? []), 2]
              return updateBranch(prev, branchNodeId, {
                ...source,
                data: {
                  ...source.data,
                  points: nextPoints,
                  indices: nextIndices,
                },
              })
            })
          }}
          onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
          onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        />
      )
    }

    render(<Wrapper />)

    await user.click(screen.getByTestId('branch-points-toggle'))
    expect(screen.getByText('Selected point: 1 ([1] memaddr)')).toBeVisible()

    await user.click(screen.getByTestId('branch-extend-toggle'))
    await user.click(screen.getByTestId('branch-extend-submit'))

    await waitFor(() => {
      expect(screen.getByText('Selected point: 2 ([2] memaddr)')).toBeVisible()
    })
  })

  it('tracks newest homoclinic endpoints for initial selection and backward extension', async () => {
    const user = userEvent.setup()
    const { system, branchNodeId } = createDemoSystem()
    const seededBranch: ContinuationObject = {
      ...system.branches[branchNodeId],
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: new Array(24).fill(0),
            param_value: 0.11,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: new Array(24).fill(0),
            param_value: 0.12,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [1, 2],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 2,
          ncol: 1,
          param1_name: 'p1',
          param2_name: 'p2',
          free_time: true,
          free_eps0: true,
          free_eps1: false,
        },
      },
      settings: continuationSettings,
      params: [0.11, 0.2],
    }

    function Wrapper() {
      const [state, setState] = useState(updateBranch(system, branchNodeId, seededBranch))
      return (
        <InspectorDetailsPanel
          system={state}
          selectedNodeId={branchNodeId}
          view="selection"
          theme="light"
          onRename={vi.fn()}
          onToggleVisibility={vi.fn()}
          onUpdateRender={vi.fn()}
          onUpdateScene={vi.fn()}
          onUpdateBifurcationDiagram={vi.fn()}
          onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
          onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
          onRunOrbit={vi.fn().mockResolvedValue(undefined)}
          onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
          onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
          onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
          onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
          onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
          onExtendBranch={async () => {
            setState((prev) => {
              const source = prev.branches[branchNodeId]
              const nextPoints = [
                ...source.data.points,
                {
                  state: new Array(24).fill(0),
                  param_value: 0.109,
                  stability: 'None',
                  eigenvalues: [],
                },
              ]
              const nextIndices = [...(source.data.indices ?? []), 0]
              return updateBranch(prev, branchNodeId, {
                ...source,
                data: {
                  ...source.data,
                  points: nextPoints,
                  indices: nextIndices,
                },
              })
            })
          }}
          onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
          onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        />
      )
    }

    render(<Wrapper />)

    await user.click(screen.getByTestId('branch-points-toggle'))
    expect((screen.getByTestId('branch-point-input') as HTMLInputElement).value).toBe('2')

    await user.click(screen.getByTestId('branch-extend-toggle'))
    await user.selectOptions(screen.getByTestId('branch-extend-direction'), 'backward')
    await user.click(screen.getByTestId('branch-extend-submit'))

    await waitFor(() => {
      expect((screen.getByTestId('branch-point-input') as HTMLInputElement).value).toBe('0')
    })
  })

  it('selects the most negative endpoint for backward-only equilibrium branches', async () => {
    const user = userEvent.setup()
    const { system, branchNodeId } = createDemoSystem()
    const baseBranch = system.branches[branchNodeId]
    if (!baseBranch) {
      throw new Error('Expected equilibrium branch fixture data.')
    }

    const backwardOnlyBranch: ContinuationObject = {
      ...baseBranch,
      data: {
        ...baseBranch.data,
        points: [
          {
            state: [-0.2, -0.2],
            param_value: -0.2,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [-0.1, -0.1],
            param_value: -0.1,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [0, 0],
            param_value: 0,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        indices: [-2, -1, 0],
      },
    }

    render(
      <InspectorDetailsPanel
        system={updateBranch(system, branchNodeId, backwardOnlyBranch)}
        selectedNodeId={branchNodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    expect(screen.getByText('Selected point: -2 ([0] memaddr)')).toBeVisible()
  })

  it('submits homoclinic-from-large-cycle requests', async () => {
    const user = userEvent.setup()
    const base = createSystem({
      name: 'Homoc_LC_Test',
      config: {
        name: 'Homoc_LC_Test',
        equations: ['y', '-x'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Seed',
      systemName: base.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Seed' },
      ntst: 4,
      ncol: 2,
      period: 6,
      state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
      createdAt: new Date().toISOString(),
    }
    const added = addObject(base, limitCycle)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_branch',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 4, ncol: 2 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateHomoclinicFromLargeCycle={onCreate}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))
    await user.click(screen.getByTestId('homoclinic-from-large-cycle-toggle'))
    await user.click(screen.getByTestId('homoclinic-from-large-cycle-submit'))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        parameterName: 'mu',
        param2Name: 'nu',
      })
    )
  })

  it('submits homoclinic-from-homoclinic requests', async () => {
    const user = userEvent.setup()
    const base = createSystem({
      name: 'Homoc_Homoc_Test',
      config: {
        name: 'Homoc_Homoc_Test',
        equations: ['y', '-x'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_seed',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: new Array(80).fill(0),
            param_value: 0.2,
            param2_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 6,
          ncol: 2,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: true,
          free_eps0: true,
          free_eps1: false,
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateHomoclinicFromHomoclinic={onCreate}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))
    expect(screen.getByTestId('homoclinic-from-homoclinic-toggle')).toHaveTextContent(
      'Continue from Point'
    )
    await user.click(screen.getByTestId('homoclinic-from-homoclinic-toggle'))
    await user.selectOptions(
      screen.getByTestId('homoclinic-from-homoclinic-parameter'),
      'nu'
    )
    await user.click(screen.getByTestId('homoclinic-from-homoclinic-submit'))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        parameterName: 'nu',
        param2Name: 'mu',
      })
    )
  })

  it('allows extending homoclinic branches with the standard extension menu', async () => {
    const user = userEvent.setup()
    const base = createSystem({
      name: 'Homoc_Extend_UI',
      config: {
        name: 'Homoc_Extend_UI',
        equations: ['y', '-x'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_seed',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: new Array(24).fill(0),
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        resume_state: {
          max_index_seed: {
            endpoint_index: 0,
            aug_state: [0.2, ...new Array(24).fill(0)],
            tangent: [1, ...new Array(24).fill(0)],
            step_size: 0.005,
          },
        },
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
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const onExtendBranch = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={onExtendBranch}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-extend-toggle'))
    expect((screen.getByTestId('branch-extend-step-size') as HTMLInputElement).value).toBe(
      '0.01'
    )
    await user.click(screen.getByTestId('branch-extend-submit'))

    expect(onExtendBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: branchResult.nodeId,
      })
    )
  })

  it('submits homotopy-saddle-from-equilibrium requests', async () => {
    const user = userEvent.setup()
    const base = createSystem({
      name: 'Homotopy_EQ_Test',
      config: {
        name: 'Homotopy_EQ_Test',
        equations: ['y', '-x'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_branch',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0, 0],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: { type: 'Equilibrium' },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateHomotopySaddleFromEquilibrium={onCreate}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))
    await user.click(screen.getByTestId('homotopy-saddle-from-equilibrium-toggle'))
    await user.click(screen.getByTestId('homotopy-saddle-from-equilibrium-submit'))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        parameterName: 'mu',
        param2Name: 'nu',
      })
    )
  })

  it('submits homoclinic-from-homotopy-saddle requests', async () => {
    const user = userEvent.setup()
    const base = createSystem({
      name: 'Homoc_HS_Test',
      config: {
        name: 'Homoc_HS_Test',
        equations: ['y', '-x'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Seed',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'homotopy_seed',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homotopy_saddle_curve',
      data: {
        points: [
          {
            state: new Array(80).fill(0),
            param_value: 0.2,
            param2_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: {
          type: 'HomotopySaddleCurve',
          ntst: 6,
          ncol: 2,
          param1_name: 'mu',
          param2_name: 'nu',
          stage: 'StageD',
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={branchResult.system}
        selectedNodeId={branchResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateHomoclinicFromHomotopySaddle={onCreate}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))
    await user.click(screen.getByTestId('homoclinic-from-homotopy-saddle-toggle'))
    await user.click(screen.getByTestId('homoclinic-from-homotopy-saddle-submit'))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: branchResult.nodeId,
        pointIndex: 0,
      })
    )
  })

  it('shows scene axis-count controls for 2D systems', () => {
    let system = createSystem({ name: 'Scene2D' })
    const sceneResult = addScene(system, 'Scene 2D')
    system = sceneResult.system

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={sceneResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.getByTestId('scene-axis-count')).toHaveValue('2')
    expect(screen.getByTestId('scene-axis-x')).toHaveValue('x')
    expect(screen.getByTestId('scene-axis-y')).toHaveValue('y')
    expect(screen.queryByTestId('scene-axis-z')).toBeNull()
  })

  it('resets scene view state when axis count changes', () => {
    let system = createSystem({
      name: 'Scene4D',
      config: {
        name: 'Scene4D',
        equations: ['x', 'y', 'z', 'w'],
        params: [],
        paramNames: [],
        varNames: ['x', 'y', 'z', 'w'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const sceneResult = addScene(system, 'Scene 4D')
    system = sceneResult.system
    const onUpdateScene = vi.fn()

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={sceneResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={onUpdateScene}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    fireEvent.change(screen.getByTestId('scene-axis-count'), { target: { value: '1' } })

    expect(onUpdateScene).toHaveBeenCalledWith(
      sceneResult.nodeId,
      expect.objectContaining({
        axisVariables: ['x'],
        viewRevision: 1,
        axisRanges: {},
        camera: DEFAULT_SCENE_CAMERA,
      })
    )
  })

  it('updates axis variables without bumping viewRevision', () => {
    let system = createSystem({
      name: 'Scene4D',
      config: {
        name: 'Scene4D',
        equations: ['x', 'y', 'z', 'w'],
        params: [],
        paramNames: [],
        varNames: ['x', 'y', 'z', 'w'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const sceneResult = addScene(system, 'Scene 4D')
    system = sceneResult.system
    const onUpdateScene = vi.fn()

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={sceneResult.nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={onUpdateScene}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onComputeLyapunovExponents={vi.fn().mockResolvedValue(undefined)}
        onComputeCovariantLyapunovVectors={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    fireEvent.change(screen.getByTestId('scene-axis-x'), { target: { value: 'w' } })

    expect(onUpdateScene).toHaveBeenCalledWith(sceneResult.nodeId, {
      axisVariables: ['w', 'y', 'z'],
    })
  })
})
