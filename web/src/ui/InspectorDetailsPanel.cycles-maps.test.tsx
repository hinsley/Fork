import {
  render, screen, waitFor, within,
  userEvent, describe, expect, it,
  vi, createPeriodDoublingSystem, InspectorDetailsPanel, useState,
  addBranch, addObject, createSystem, updateLimitCycleRenderTarget,
  buildSubsystemSnapshot, continuationSettings, type ContinuationObject, type EquilibriumObject,
  type LimitCycleObject, type SystemConfig,
} from './InspectorDetailsPanel.testSupport'

describe('InspectorDetailsPanel: limit cycles and map workflows', () => {
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

    await user.click(screen.getByTestId('branch-points-toggle'))
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
    const parametersToggle = screen.getByTestId('limit-cycle-data-parameters-toggle')
    await user.click(parametersToggle)
    await user.click(screen.getByTestId('limit-cycle-data-floquet-toggle'))

    expect(
      within(parametersToggle.closest('details') as HTMLElement).getByText('0.250000')
    ).toBeVisible()
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
    await user.click(screen.getByTestId('limit-cycle-data-floquet-toggle'))

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
    await user.click(screen.getByTestId('limit-cycle-data-floquet-toggle'))
    expect(screen.getByText('Floquet multipliers not computed yet.')).toBeVisible()

    const computeButton = screen.getByTestId('limit-cycle-floquet-modes-compute')
    expect(computeButton).toBeEnabled()
    await user.selectOptions(
      screen.getByTestId('limit-cycle-floquet-backend'),
      'periodic_schur'
    )
    await user.click(computeButton)

    expect(onComputeLimitCycleFloquetModes).toHaveBeenCalledWith({
      limitCycleId,
      backend: 'periodic_schur',
    })
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
    await user.click(screen.getByTestId('limit-cycle-data-floquet-toggle'))
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
      settings: {
        step_size: 0.01,
        max_steps: 50,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        corrector_steps: 10,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
        collocation_adaptivity: {
          enabled: true,
          redistribution_enabled: true,
          defect_tolerance: 0.025,
          max_refinements: 3,
          max_mesh_points: 512,
        },
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
})
