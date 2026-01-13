import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDemoSystem } from '../system/fixtures'
import { InspectorDetailsPanel } from './InspectorDetailsPanel'
import { useState } from 'react'
import {
  addBranch,
  addObject,
  createSystem,
  renameNode,
  toggleNodeVisibility,
  updateNodeRender,
} from '../system/model'
import type { ContinuationObject, EquilibriumObject, LimitCycleObject } from '../system/types'

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
    const onCreateLimitCycle = vi.fn().mockResolvedValue(undefined)
    const onCreateEquilibriumBranch = vi.fn().mockResolvedValue(undefined)
    const onCreateBranchFromPoint = vi.fn().mockResolvedValue(undefined)
    const onExtendBranch = vi.fn().mockResolvedValue(undefined)
    const onCreateFoldCurveFromPoint = vi.fn().mockResolvedValue(undefined)
    const onCreateHopfCurveFromPoint = vi.fn().mockResolvedValue(undefined)
    const onCreateLimitCycleFromHopf = vi.fn().mockResolvedValue(undefined)

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
          onCreateLimitCycle={onCreateLimitCycle}
          onCreateEquilibriumBranch={onCreateEquilibriumBranch}
          onCreateBranchFromPoint={onCreateBranchFromPoint}
          onExtendBranch={onExtendBranch}
          onCreateFoldCurveFromPoint={onCreateFoldCurveFromPoint}
          onCreateHopfCurveFromPoint={onCreateHopfCurveFromPoint}
          onCreateLimitCycleFromHopf={onCreateLimitCycleFromHopf}
          onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
          onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        />
      )
    }

    render(<Wrapper />)

    const nameInput = screen.getByTestId('inspector-name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Orbit Q')
    expect(onRename).toHaveBeenLastCalledWith(objectNodeId, 'Orbit Q')

    await user.click(screen.getByTestId('inspector-visibility'))
    expect(onToggleVisibility).toHaveBeenCalledWith(objectNodeId)

    const lineWidth = screen.getByTestId('inspector-line-width')
    await user.clear(lineWidth)
    await user.type(lineWidth, '3')
    expect(onUpdateRender).toHaveBeenLastCalledWith(objectNodeId, { lineWidth: 3 })
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
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const nameInput = screen.getByTestId('system-name')
    await user.clear(nameInput)
    await user.type(nameInput, 'New System')

    await user.click(screen.getByTestId('system-apply'))

    expect(onUpdateSystem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New System' })
    )
  })

  it('runs orbit and creates limit cycle requests', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const onRunOrbit = vi.fn().mockResolvedValue(undefined)
    const onCreateLimitCycle = vi.fn().mockResolvedValue(undefined)

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
        onCreateLimitCycle={onCreateLimitCycle}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
      onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
      onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
      onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
      onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
      onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
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

    await user.click(screen.getByTestId('limit-cycle-toggle'))
    await user.clear(screen.getByTestId('limit-cycle-name'))
    await user.type(screen.getByTestId('limit-cycle-name'), 'LC_Q')
    await user.clear(screen.getByTestId('limit-cycle-period'))
    await user.type(screen.getByTestId('limit-cycle-period'), '6')
    await user.clear(screen.getByTestId('limit-cycle-state-0'))
    await user.type(screen.getByTestId('limit-cycle-state-0'), '0.1')
    await user.clear(screen.getByTestId('limit-cycle-state-1'))
    await user.type(screen.getByTestId('limit-cycle-state-1'), '0.2')

    await user.click(screen.getByTestId('limit-cycle-submit'))

    expect(onCreateLimitCycle).toHaveBeenCalledWith({
      name: 'LC_Q',
      originOrbitId: objectNodeId,
      period: 6,
      state: [0.1, 0.2],
      ntst: 50,
      ncol: 4,
      parameterName: undefined,
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
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={onCreateLimitCycleFromOrbit}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('limit-cycle-from-orbit-toggle'))
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
  })

  it('suggests cli-safe branch names for orbit limit cycle continuation', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const systemWithParams = {
      ...system,
      config: {
        ...system.config,
        paramNames: ['mu beta'],
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
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('limit-cycle-from-orbit-toggle'))
    const branchInput = screen.getByTestId('limit-cycle-from-orbit-branch-name')

    await waitFor(() => {
      expect(branchInput).toHaveValue('lc_Orbit_A_mu_beta')
    })
  })

  it('suggests cli-safe branch names for hopf limit cycle continuation', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Hopf Name System' })
    const configuredSystem = {
      ...baseSystem,
      config: {
        ...baseSystem.config,
        paramNames: ['mu beta', 'kappa'],
        params: [-0.1, 0.2],
      },
    }
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ Hopf',
      systemName: configuredSystem.config.name,
      parameters: [...configuredSystem.config.params],
    }
    const added = addObject(configuredSystem, eqObject)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq hopf',
      systemName: configuredSystem.config.name,
      parameterName: 'mu beta',
      parentObject: eqObject.name,
      startObject: eqObject.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0, 0],
            param_value: 0,
            stability: 'Hopf',
            eigenvalues: [
              { re: 0, im: 1 },
              { re: 0, im: -1 },
            ],
          },
        ],
        bifurcations: [0],
        indices: [0],
      },
      settings: {
        step_size: 0.02,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 40,
        corrector_steps: 6,
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
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))
    await user.click(screen.getByTestId('limit-cycle-from-hopf-toggle'))

    const branchInput = screen.getByTestId('limit-cycle-from-hopf-branch-name')
    await waitFor(() => {
      expect(branchInput).toHaveValue('lc_hopf_eq_hopf_mu_beta')
    })
  })

  it('suggests cli-safe branch names for PD limit cycle continuation', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'PD Name System' })
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
        indices: [0, 1],
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
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
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

  it('creates limit cycle continuation from Hopf with a selected parameter', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Hopf LC Param System' })
    const configuredSystem = {
      ...baseSystem,
      config: {
        ...baseSystem.config,
        paramNames: ['mu', 'beta'],
        params: [-0.1, 0.2],
      },
    }
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ Hopf',
      systemName: configuredSystem.config.name,
      parameters: [...configuredSystem.config.params],
    }
    const added = addObject(configuredSystem, eqObject)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_hopf_mu',
      systemName: configuredSystem.config.name,
      parameterName: 'mu',
      parentObject: eqObject.name,
      startObject: eqObject.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0, 0],
            param_value: 0,
            stability: 'Hopf',
            eigenvalues: [
              { re: 0, im: 1 },
              { re: 0, im: -1 },
            ],
          },
        ],
        bifurcations: [0],
        indices: [0],
      },
      settings: {
        step_size: 0.02,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 40,
        corrector_steps: 6,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...configuredSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const onCreateLimitCycleFromHopf = vi.fn().mockResolvedValue(undefined)

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
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={onCreateLimitCycleFromHopf}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))
    await user.click(screen.getByTestId('limit-cycle-from-hopf-toggle'))
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-name'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-name'), 'lc_hopf_beta')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-branch-name'))
    await user.type(
      screen.getByTestId('limit-cycle-from-hopf-branch-name'),
      'lc_hopf_beta_branch'
    )
    await user.selectOptions(screen.getByTestId('limit-cycle-from-hopf-parameter'), 'beta')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-amplitude'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-amplitude'), '0.1')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-ntst'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-ntst'), '20')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-ncol'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-ncol'), '4')
    await user.selectOptions(
      screen.getByTestId('limit-cycle-from-hopf-direction'),
      'backward'
    )
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-step-size'), '0.02')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-max-steps'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-max-steps'), '20')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-min-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-min-step-size'), '1e-6')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-max-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-max-step-size'), '0.1')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-corrector-steps'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-corrector-steps'), '6')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-corrector-tolerance'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-corrector-tolerance'), '1e-6')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-step-tolerance'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-step-tolerance'), '1e-6')
    await user.click(screen.getByTestId('limit-cycle-from-hopf-submit'))

    expect(onCreateLimitCycleFromHopf).toHaveBeenCalledWith({
      branchId: branchResult.nodeId,
      pointIndex: 0,
      limitCycleName: 'lc_hopf_beta',
      branchName: 'lc_hopf_beta_branch',
      parameterName: 'beta',
      amplitude: 0.1,
      ntst: 20,
      ncol: 4,
      settings: {
        step_size: 0.02,
        max_steps: 20,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        corrector_steps: 6,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      forward: false,
    })
  })

  it('creates limit cycle continuation from Hopf curve points', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Hopf Curve LC System' })
    const configuredSystem = {
      ...baseSystem,
      config: {
        ...baseSystem.config,
        paramNames: ['p1', 'p2'],
        params: [-0.2, 0.2],
      },
    }
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ Hopf Curve',
      systemName: configuredSystem.config.name,
      parameters: [...configuredSystem.config.params],
    }
    const added = addObject(configuredSystem, eqObject)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'hopf_curve_branch',
      systemName: configuredSystem.config.name,
      parameterName: 'p1, p2',
      parentObject: eqObject.name,
      startObject: eqObject.name,
      branchType: 'hopf_curve',
      data: {
        points: [
          {
            state: [0, 0],
            param_value: -0.2,
            param2_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: { type: 'HopfCurve', param1_name: 'p1', param2_name: 'p2' },
      },
      settings: {
        step_size: 0.02,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        max_steps: 20,
        corrector_steps: 5,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [...configuredSystem.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const onCreateLimitCycleFromHopf = vi.fn().mockResolvedValue(undefined)

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
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={onCreateLimitCycleFromHopf}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))
    await user.click(screen.getByTestId('limit-cycle-from-hopf-toggle'))
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-name'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-name'), 'lc_hopf_curve')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-branch-name'))
    await user.type(
      screen.getByTestId('limit-cycle-from-hopf-branch-name'),
      'lc_hopf_curve_branch'
    )
    await user.selectOptions(screen.getByTestId('limit-cycle-from-hopf-parameter'), 'p2')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-amplitude'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-amplitude'), '0.05')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-ntst'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-ntst'), '15')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-ncol'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-ncol'), '4')
    await user.selectOptions(
      screen.getByTestId('limit-cycle-from-hopf-direction'),
      'forward'
    )
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-step-size'), '0.02')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-max-steps'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-max-steps'), '20')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-min-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-min-step-size'), '1e-6')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-max-step-size'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-max-step-size'), '0.1')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-corrector-steps'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-corrector-steps'), '5')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-corrector-tolerance'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-corrector-tolerance'), '1e-6')
    await user.clear(screen.getByTestId('limit-cycle-from-hopf-step-tolerance'))
    await user.type(screen.getByTestId('limit-cycle-from-hopf-step-tolerance'), '1e-6')
    await user.click(screen.getByTestId('limit-cycle-from-hopf-submit'))

    expect(onCreateLimitCycleFromHopf).toHaveBeenCalledWith({
      branchId: branchResult.nodeId,
      pointIndex: 0,
      limitCycleName: 'lc_hopf_curve',
      branchName: 'lc_hopf_curve_branch',
      parameterName: 'p2',
      amplitude: 0.05,
      ntst: 15,
      ncol: 4,
      settings: {
        step_size: 0.02,
        max_steps: 20,
        min_step_size: 1e-6,
        max_step_size: 0.1,
        corrector_steps: 5,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      forward: true,
    })
  })

  it('branches to period-doubled limit cycles', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'PD System' })
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
        indices: [0, 1],
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
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={onCreateLimitCycleFromPD}
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
  })

  it('solves equilibrium requests', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Test System' })
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
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
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

  it('toggles equilibrium eigenvector plotting', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Eigenvector System' })
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
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
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
})
