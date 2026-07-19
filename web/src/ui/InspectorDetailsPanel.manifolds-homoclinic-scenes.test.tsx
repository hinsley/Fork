import {
  fireEvent, render, screen, waitFor,
  userEvent, describe, expect, it,
  vi, createDemoSystem, InspectorDetailsPanel, useState,
  DEFAULT_SCENE_CAMERA, addScene, addBranch, addObject,
  createSystem, updateBranch, updateNodeRender, renderPlot,
  continuationSettings, type ContinuationObject, type EquilibriumObject, type LimitCycleObject,
  type SystemConfig,
} from './InspectorDetailsPanel.testSupport'

describe('InspectorDetailsPanel: manifolds, connections, and scenes', () => {
  it('hides "Limit Cycle from Hopf" for non-Hopf equilibrium points', () => {
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

    expect(screen.queryByTestId('limit-cycle-from-hopf-toggle')).toBeNull()
    expect(
      screen.queryByText('Select a Hopf bifurcation point to continue a limit cycle.')
    ).toBeNull()
  })

  it('hides "Limit Cycle from Hopf" and renders event diagnostics for homoclinic branches', async () => {
    const user = userEvent.setup()
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
            homoclinic_events: {
              stable_dimension: 1,
              unstable_dimension: 1,
              discarded_eigenvalues: 0,
              events: [
                {
                  kind: 'NNS',
                  name: 'Neutral saddle',
                  value: -0.125,
                  status: 'available',
                  reason: null,
                },
                {
                  kind: 'IFU',
                  name: 'Inclination flip (unstable manifold)',
                  value: null,
                  status: 'unsupported',
                  reason: 'adjoint continuation is unavailable',
                },
              ],
            },
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
    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))
    await user.click(screen.getByTestId('branch-point-details-toggle'))
    expect(screen.getByTestId('homoclinic-event-diagnostics')).toHaveTextContent(
      'NNS · Neutral saddle'
    )
    expect(screen.getByTestId('homoclinic-event-diagnostics')).toHaveTextContent(
      'available · value -1.250000e-1 · reason —'
    )
    expect(screen.getByTestId('homoclinic-event-diagnostics')).toHaveTextContent(
      'unsupported · value unavailable · reason adjoint continuation is unavailable'
    )
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

    await user.click(screen.getByTestId('action-equilibrium-solver-toggle'))
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

    await user.click(screen.getByTestId('action-equilibrium-data-toggle'))

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

    await user.click(screen.getByTestId('action-equilibrium-data-toggle'))
    await user.click(screen.getByTestId('equilibrium-data-eigenpairs-toggle'))
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
    await user.click(screen.getByTestId('action-equilibrium-data-toggle'))
    await user.click(screen.getByTestId('equilibrium-data-eigenpairs-toggle'))

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

  it('filters surface eigen-indexes and hides 1D mode for higher-dimensional sides', async () => {
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
        onCreateIsoperiodicCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleManifold2D={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('action-equilibrium-manifold-toggle'))

    const profile = screen.getByTestId('equilibrium-manifold2d-profile') as HTMLSelectElement
    expect(profile.value).toBe('adaptive_global')
    expect((screen.getByTestId('equilibrium-manifold2d-leaf-delta') as HTMLInputElement).value).toBe(
      '0.2'
    )
    expect((screen.getByTestId('equilibrium-manifold2d-ring-points') as HTMLInputElement).value).toBe(
      '32'
    )
    expect((screen.getByTestId('equilibrium-manifold2d-min-spacing') as HTMLInputElement).value).toBe(
      '0.05'
    )
    expect((screen.getByTestId('equilibrium-manifold2d-max-spacing') as HTMLInputElement).value).toBe(
      '0.5'
    )

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

    await user.selectOptions(screen.getByTestId('equilibrium-manifold-stability'), 'Stable')
    const mode = screen.getByTestId('equilibrium-manifold-mode') as HTMLSelectElement
    expect(Array.from(mode.options).map((option) => option.value)).toEqual(['surface_2d'])
    expect(screen.queryByTestId('equilibrium-manifold-eig-index')).toBeNull()
  })

  it('auto-picks equilibrium manifold mode when only one mode is eligible for selected stability', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'Manifold_Mode_AutoPick_System',
      config: {
        name: 'Manifold_Mode_AutoPick_System',
        equations: ['x', 'y', 'z'],
        params: [0],
        paramNames: ['mu'],
        varNames: ['x', 'y', 'z'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Mode',
      systemName: baseSystem.config.name,
      solution: {
        state: [0, 0, 0],
        residual_norm: 0,
        iterations: 2,
        jacobian: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        eigenpairs: [
          { value: { re: 0.6, im: 0 }, vector: [{ re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }] },
          { value: { re: -0.4, im: 0.9 }, vector: [{ re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 0 }] },
          { value: { re: -0.4, im: -0.9 }, vector: [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }] },
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
        onCreateIsoperiodicCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleManifold2D={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('action-equilibrium-manifold-toggle'))

    const modeSelect = screen.getByTestId('equilibrium-manifold-mode') as HTMLSelectElement
    expect(modeSelect.value).toBe('surface_2d')
    expect(Array.from(modeSelect.options).map((option) => option.textContent)).toEqual([
      '2D surface',
    ])
    expect(modeSelect).toBeDisabled()

    await user.selectOptions(screen.getByTestId('equilibrium-manifold-stability'), 'Unstable')
    await waitFor(() => {
      expect(modeSelect.value).toBe('curve_1d')
      expect(Array.from(modeSelect.options).map((option) => option.textContent)).toEqual([
        '1D curve',
      ])
    })
    expect(modeSelect).toBeDisabled()

    await user.selectOptions(screen.getByTestId('equilibrium-manifold-stability'), 'Stable')
    await waitFor(() => {
      expect(modeSelect.value).toBe('surface_2d')
      expect(Array.from(modeSelect.options).map((option) => option.textContent)).toEqual([
        '2D surface',
      ])
    })
  })

  it('restricts map equilibrium manifold mode options to 1D', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'Map_Manifold_Mode_System',
      config: {
        name: 'Map_Manifold_Mode_System',
        equations: ['mu * x * (1 - x)', '0.6 * y', '0.4 * z'],
        params: [2.8],
        paramNames: ['mu'],
        varNames: ['x', 'y', 'z'],
        solver: 'discrete',
        type: 'map',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Map_Mode',
      systemName: baseSystem.config.name,
      solution: {
        state: [0.3, 0.0, 0.0],
        residual_norm: 0,
        iterations: 2,
        jacobian: [1.2, 0, 0, 0, 0.7, 0, 0, 0, 0.5],
        eigenpairs: [
          { value: { re: 1.2, im: 0 }, vector: [{ re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }] },
          { value: { re: 0.7, im: 0 }, vector: [{ re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 0 }] },
          { value: { re: 0.2, im: 0.8 }, vector: [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }] },
        ],
        cycle_points: [[0.3, 0.0, 0.0], [0.6, 0.0, 0.0]],
      },
      lastSolverParams: {
        initialGuess: [0.2, 0.0, 0.0],
        maxSteps: 16,
        dampingFactor: 1,
        mapIterations: 2,
      },
      parameters: [...baseSystem.config.params],
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
        onCreateIsoperiodicCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleManifold2D={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('action-equilibrium-manifold-toggle'))

    expect(
      screen.getByText('Map systems currently support 1D equilibrium manifolds only.')
    ).toBeInTheDocument()
    const modeSelect = screen.getByTestId('equilibrium-manifold-mode') as HTMLSelectElement
    expect(modeSelect.value).toBe('curve_1d')
    expect(Array.from(modeSelect.options).map((option) => option.textContent)).toEqual([
      '1D curve',
    ])
    expect(modeSelect).toBeDisabled()
  })

  it('filters map equilibrium manifold eigen-indexes by multiplier modulus side', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'Map_Manifold_Filter_System',
      config: {
        name: 'Map_Manifold_Filter_System',
        equations: ['mu * x * (1 - x)', '0.7 * y'],
        params: [3.1],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'discrete',
        type: 'map',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Map_Filter',
      systemName: baseSystem.config.name,
      solution: {
        state: [0.2, 0.0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [1.2, 0, 0, 0.8],
        eigenpairs: [
          { value: { re: 1.2, im: 0 }, vector: [{ re: 1, im: 0 }, { re: 0, im: 0 }] },
          { value: { re: 0.9, im: 0 }, vector: [{ re: 0, im: 0 }, { re: 1, im: 0 }] },
          { value: { re: -1.3, im: 0 }, vector: [{ re: 1, im: 0 }, { re: 0, im: 0 }] },
          { value: { re: -0.8, im: 0 }, vector: [{ re: 0, im: 0 }, { re: 1, im: 0 }] },
          { value: { re: 0.7, im: 0.4 }, vector: [{ re: 1, im: 0 }, { re: 0, im: 0 }] },
        ],
      },
      parameters: [...baseSystem.config.params],
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
        onCreateIsoperiodicCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleManifold2D={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('action-equilibrium-manifold-toggle'))
    const eigIndex = screen.getByTestId('equilibrium-manifold-eig-index') as HTMLSelectElement
    expect(Array.from(eigIndex.options).map((option) => option.textContent)).toEqual(['1', '3'])

    await user.selectOptions(screen.getByTestId('equilibrium-manifold-stability'), 'Stable')
    await waitFor(() => {
      expect(Array.from(eigIndex.options).map((option) => option.textContent)).toEqual([
        '2',
        '4',
      ])
    })
  })

  it('passes mapIterations when running map equilibrium manifold 1D', async () => {
    const user = userEvent.setup()
    const onCreateEquilibriumManifold1D = vi.fn().mockResolvedValue(undefined)
    const baseSystem = createSystem({
      name: 'Map_Manifold_Request_System',
      config: {
        name: 'Map_Manifold_Request_System',
        equations: ['mu * x * (1 - x)'],
        params: [3.2],
        paramNames: ['mu'],
        varNames: ['x'],
        solver: 'discrete',
        type: 'map',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Map_Request',
      systemName: baseSystem.config.name,
      solution: {
        state: [0.2],
        residual_norm: 0,
        iterations: 2,
        jacobian: [1.4],
        eigenpairs: [{ value: { re: 1.4, im: 0 }, vector: [{ re: 1, im: 0 }] }],
        cycle_points: [[0.2], [0.7]],
      },
      lastSolverParams: {
        initialGuess: [0.2],
        maxSteps: 20,
        dampingFactor: 1,
        mapIterations: 2,
      },
      parameters: [...baseSystem.config.params],
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
        onCreateEquilibriumManifold1D={onCreateEquilibriumManifold1D}
        onCreateEquilibriumManifold2D={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
        onExtendBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateFoldCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateHopfCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateIsoperiodicCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleManifold2D={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('action-equilibrium-manifold-toggle'))
    expect(screen.queryByTestId('equilibrium-manifold-integration-dt')).toBeNull()
    const maxIterationsInput = screen.getByTestId(
      'equilibrium-manifold-caps-max-iterations'
    ) as HTMLInputElement
    await user.clear(maxIterationsInput)
    await user.type(maxIterationsInput, '345')
    await user.click(screen.getByTestId('equilibrium-manifold-submit'))

    await waitFor(() => {
      expect(onCreateEquilibriumManifold1D).toHaveBeenCalledTimes(1)
    })
    const request = onCreateEquilibriumManifold1D.mock.calls[0]?.[0]
    expect(request.mapIterations).toBe(2)
    expect(request.settings.stability).toBe('Unstable')
    expect(request.settings.direction).toBe('Both')
    expect(request.settings.integration_dt).toBe(1)
    expect(request.settings.caps.max_iterations).toBe(345)
  })

  it('filters limit-cycle manifold Floquet options and auto-corrects selection by stability', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'LC_Manifold_Filter_System',
      config: {
        name: 'LC_Manifold_Filter_System',
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
      name: 'LC_Filter',
      systemName: baseSystem.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Filter' },
      ntst: 4,
      ncol: 2,
      period: 6.0,
      state: [1, 0, 0, 1, -1, 0, 0, -1, 6.0],
      parameters: [0.2],
      parameterName: 'mu',
      floquetMultipliers: [
        { re: 1.0, im: 0.0 },
        { re: 1.3, im: 0.0 },
        { re: 0.6, im: 0.0 },
        { re: 0.8, im: 0.2 },
        { re: 0.9995, im: 0.0 },
      ],
      createdAt: new Date().toISOString(),
    }
    const added = addObject(baseSystem, limitCycle)

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
        onCreateIsoperiodicCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleManifold2D={vi.fn().mockResolvedValue(undefined)}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('limit-cycle-manifold-toggle'))

    const direction = screen.getByTestId(
      'limit-cycle-manifold-direction'
    ) as HTMLSelectElement
    expect(Array.from(direction.options).map((option) => option.value)).toEqual([
      'Plus',
      'Minus',
    ])
    expect(direction.value).toBe('Plus')

    const floquetIndex = screen.getByTestId(
      'limit-cycle-manifold-floquet-index'
    ) as HTMLSelectElement

    await waitFor(() => {
      expect(Array.from(floquetIndex.options).map((option) => option.value)).toEqual(['1'])
      expect(floquetIndex.value).toBe('1')
    })

    await user.selectOptions(screen.getByTestId('limit-cycle-manifold-stability'), 'Stable')

    await waitFor(() => {
      expect(Array.from(floquetIndex.options).map((option) => option.value)).toEqual(['2'])
      expect(floquetIndex.value).toBe('2')
    })
  })

  it('submits the selected limit-cycle manifold algorithm', async () => {
    const user = userEvent.setup()
    const onCreateLimitCycleManifold2D = vi.fn().mockResolvedValue(undefined)
    const baseSystem = createSystem({
      name: 'LC_Manifold_Algorithm_System',
      config: {
        name: 'LC_Manifold_Algorithm_System',
        equations: ['y', '-x', '0.2 * z'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['x', 'y', 'z'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Algorithm',
      systemName: baseSystem.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Algorithm' },
      ntst: 4,
      ncol: 2,
      period: 6.0,
      state: [1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0, 6.0],
      parameters: [0.2],
      parameterName: 'mu',
      floquetMultipliers: [
        { re: 1.0, im: 0.0 },
        { re: 1.4, im: 0.0 },
      ],
      createdAt: new Date().toISOString(),
    }
    const added = addObject(baseSystem, limitCycle)

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
        onCreateIsoperiodicCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateNSCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromHopf={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleManifold2D={onCreateLimitCycleManifold2D}
        onCreateCycleFromPD={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycleFromPD={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('limit-cycle-manifold-toggle'))
    const algorithm = screen.getByTestId('limit-cycle-manifold-algorithm') as HTMLSelectElement
    expect(algorithm.value).toBe('GeodesicRings')
    expect(
      Array.from(algorithm.options).map((option) => [option.value, option.textContent])
    ).toContainEqual(['SegmentedPreimageFibers', 'segmented preimage fibers (fast)'])
    await user.selectOptions(algorithm, 'IsochronFibers')
    await user.click(screen.getByTestId('limit-cycle-manifold-submit'))

    await waitFor(() => {
      expect(onCreateLimitCycleManifold2D).toHaveBeenCalledTimes(1)
    })
    expect(onCreateLimitCycleManifold2D.mock.calls[0]?.[0]?.settings.algorithm).toBe(
      'IsochronFibers'
    )
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
    expect(screen.getByTestId('homoclinic-from-large-cycle-free-time')).toBeDisabled()
    expect(screen.getByTestId('homoclinic-from-large-cycle-method')).toHaveValue('collocation')
    expect(
      screen.getByTestId('homoclinic-from-large-cycle-adaptive-collocation-enabled')
    ).toBeVisible()
    expect(screen.queryByTestId('homoclinic-from-large-cycle-shooting-intervals')).toBeNull()
    await user.selectOptions(
      screen.getByTestId('homoclinic-from-large-cycle-method'),
      'shooting'
    )
    expect(
      screen.queryByTestId('homoclinic-from-large-cycle-adaptive-collocation-enabled')
    ).toBeNull()
    await user.clear(screen.getByTestId('homoclinic-from-large-cycle-shooting-intervals'))
    await user.type(screen.getByTestId('homoclinic-from-large-cycle-shooting-intervals'), '6')
    await user.clear(
      screen.getByTestId('homoclinic-from-large-cycle-integration-steps-per-segment')
    )
    await user.type(
      screen.getByTestId('homoclinic-from-large-cycle-integration-steps-per-segment'),
      '96'
    )
    await user.click(screen.getByTestId('homoclinic-from-large-cycle-submit'))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        parameterName: 'mu',
        param2Name: 'nu',
        discretization: 'shooting',
        shootingIntervals: 6,
        integrationStepsPerSegment: 96,
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
    expect(screen.getByTestId('homoclinic-from-homoclinic-free-eps1')).toBeDisabled()
    expect(screen.getByTestId('homoclinic-from-homoclinic-discretization')).toHaveValue(
      'collocation'
    )
    expect(
      screen.getByTestId('homoclinic-from-homoclinic-adaptive-collocation-enabled')
    ).toBeVisible()
    await user.selectOptions(
      screen.getByTestId('homoclinic-from-homoclinic-discretization'),
      'shooting'
    )
    await user.clear(screen.getByTestId('homoclinic-from-homoclinic-shooting-intervals'))
    await user.type(screen.getByTestId('homoclinic-from-homoclinic-shooting-intervals'), '9')
    await user.clear(screen.getByTestId('homoclinic-from-homoclinic-integration-steps'))
    await user.type(screen.getByTestId('homoclinic-from-homoclinic-integration-steps'), '72')
    expect(
      screen.queryByTestId('homoclinic-from-homoclinic-adaptive-collocation-enabled')
    ).toBeNull()
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
        discretization: 'shooting',
        shootingIntervals: 9,
        integrationStepsPerSegment: 72,
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
    expect(screen.getByTestId('homoclinic-from-homotopy-saddle-free-time')).toBeDisabled()
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
