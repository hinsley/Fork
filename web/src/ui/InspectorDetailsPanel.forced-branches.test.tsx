import {
  fireEvent, render, screen, waitFor,
  userEvent, describe, expect, it,
  vi, InspectorDetailsPanel, buildCollocationAdaptivitySettings, addBranch,
  addObject, createSystem, updateBranch, updateObject,
  buildSubsystemSnapshot, continuationSettings, createStateSpaceStrideBranchFixture, renderInspectorForStateSpaceStride,
  type Codim2PointData, type ContinuationObject, type EquilibriumObject, type ForcedPeriodicResponseObject,
  type LimitCycleObject, type OrbitObject, type System, type SystemConfig,
} from './InspectorDetailsPanel.testSupport'

describe('InspectorDetailsPanel: forced responses and branch navigation', () => {
  it('solves and continues forced periodic responses with live forcing', async () => {
    const config: SystemConfig = {
      name: 'Forced_Flow',
      equations: ['-x + a*cos(t)'],
      params: [0.2],
      paramNames: ['a'],
      varNames: ['x'],
      solver: 'rk4',
      type: 'flow',
      periodicForcing: { symbol: 't', periodExpression: 'tau' },
    }
    const base = createSystem({ name: config.name, config })
    const response: ForcedPeriodicResponseObject = {
      type: 'forced_periodic_response',
      name: 'Forced_1',
      systemName: config.name,
      origin: { type: 'manual' },
      solution: {
        state: [0.1],
        residual_norm: 1e-12,
        iterations: 2,
        monodromy: [0.5],
        multipliers: [{ re: 0.5, im: 0 }],
        cycle_points: [[0.1], [0.2], [0.1]],
        contexts: [0, Math.PI, 2 * Math.PI],
        forcing_period: 2 * Math.PI,
        response_multiple: 1,
        minimal_response_multiple: 1,
      },
      solutionProvenance: {
        systemType: 'flow',
        solver: 'rk4',
        periodicForcing: { symbol: 't', periodExpression: 'tau' },
        phase: 0,
        responseMultiple: 1,
        stepsPerForcingPeriod: 200,
        parameters: [0.2],
        subsystemHash: buildSubsystemSnapshot(config).hash,
      },
      lastSolverParams: {
        initialGuess: [0],
        phase: 0,
        responseMultiple: 1,
        stepsPerForcingPeriod: 200,
        maxSteps: 25,
        dampingFactor: 1,
        tolerance: 1e-9,
      },
      parameters: [0.2],
      createdAt: new Date().toISOString(),
    }
    const added = addObject(base, response)
    const onSolve = vi.fn().mockResolvedValue(undefined)
    const onContinue = vi.fn().mockResolvedValue(undefined)
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
        onSolveForcedPeriodicResponse={onSolve}
        onCreateForcedPeriodicResponseBranch={onContinue}
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
    expect(screen.getByTestId('action-forced-response-solver-toggle')).toHaveTextContent(
      'Solve forced response'
    )
    expect(screen.getByTestId('action-forced-response-data-toggle')).toHaveTextContent(
      'View Data'
    )
    expect(screen.getByTestId('action-forced-response-continuation-toggle')).toHaveTextContent(
      'Continue forced response'
    )
    expect(screen.getByText('Forcing period')).toBeInTheDocument()
    expect(screen.getByText(/μ1 =/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('forced-response-solve-submit'))
    await waitFor(() => expect(onSolve).toHaveBeenCalledWith(expect.objectContaining({
      responseId: added.nodeId,
      responseMultiple: 1,
      stepsPerForcingPeriod: 200,
    })))
    fireEvent.click(screen.getByTestId('forced-response-branch-submit'))
    await waitFor(() => expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({
      responseId: added.nodeId,
      parameterName: 'a',
    })))
    fireEvent.change(screen.getByTestId('forced-response-phase'), {
      target: { value: '0.25' },
    })
    expect(screen.getByTestId('forced-response-stale')).toBeInTheDocument()
    expect(screen.getByTestId('forced-response-branch-submit')).toBeDisabled()
  })

  it('sets and restores forced-response render targets from the branch navigator', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Forced_Render_Target',
      equations: ['-x + a*cos(t)'],
      params: [0.2],
      paramNames: ['a'],
      varNames: ['x'],
      solver: 'rk4',
      type: 'flow',
      periodicForcing: { symbol: 't', periodExpression: 'tau' },
    }
    const response: ForcedPeriodicResponseObject = {
      type: 'forced_periodic_response',
      name: 'Forced_1',
      systemName: config.name,
      origin: { type: 'manual' },
      solution: {
        state: [0.1],
        residual_norm: 1e-12,
        iterations: 2,
        monodromy: [0.5],
        multipliers: [{ re: 0.5, im: 0 }],
        cycle_points: [[0.1], [0.2], [0.1]],
        contexts: [0, Math.PI, 2 * Math.PI],
        forcing_period: 2 * Math.PI,
        response_multiple: 1,
        minimal_response_multiple: 1,
      },
      lastSolverParams: {
        initialGuess: [0],
        phase: 0,
        responseMultiple: 1,
        stepsPerForcingPeriod: 200,
        maxSteps: 25,
        dampingFactor: 1,
        tolerance: 1e-9,
      },
      parameters: [0.2],
      createdAt: new Date().toISOString(),
    }
    const withResponse = addObject(createSystem({ name: config.name, config }), response)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'forced_a',
      systemName: config.name,
      parameterName: 'a',
      parameterRef: { kind: 'native_param', name: 'a' },
      parentObject: response.name,
      startObject: response.name,
      branchType: 'forced_periodic_response',
      data: {
        points: [
          {
            state: [0.3],
            param_value: 0.4,
            stability: 'None',
            eigenvalues: [{ re: 0.6, im: 0 }],
            cycle_points: [[0.3], [0.4], [0.3]],
          },
        ],
        bifurcations: [],
        indices: [7],
        branch_type: {
          type: 'ForcedPeriodicResponse',
          symbol: 't',
          period_expression: 'tau',
          phase: 0,
          response_multiple: 1,
          steps_per_forcing_period: 200,
          integrator: 'rk4',
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2],
    }
    const withBranch = addBranch(withResponse.system, branch, withResponse.nodeId)
    const onSetRenderTarget = vi.fn()
    const commonProps = {
      view: 'selection' as const,
      theme: 'light' as const,
      onRename: vi.fn(),
      onToggleVisibility: vi.fn(),
      onUpdateRender: vi.fn(),
      onUpdateScene: vi.fn(),
      onUpdateBifurcationDiagram: vi.fn(),
      onUpdateSystem: vi.fn().mockResolvedValue(undefined),
      onValidateSystem: vi.fn().mockResolvedValue({ ok: true, equationErrors: [] }),
      onRunOrbit: vi.fn().mockResolvedValue(undefined),
      onComputeLyapunovExponents: vi.fn().mockResolvedValue(undefined),
      onComputeCovariantLyapunovVectors: vi.fn().mockResolvedValue(undefined),
      onSolveEquilibrium: vi.fn().mockResolvedValue(undefined),
      onCreateEquilibriumBranch: vi.fn().mockResolvedValue(undefined),
      onCreateBranchFromPoint: vi.fn().mockResolvedValue(undefined),
      onExtendBranch: vi.fn().mockResolvedValue(undefined),
      onCreateFoldCurveFromPoint: vi.fn().mockResolvedValue(undefined),
      onCreateHopfCurveFromPoint: vi.fn().mockResolvedValue(undefined),
      onCreateNSCurveFromPoint: vi.fn().mockResolvedValue(undefined),
      onCreateLimitCycleFromHopf: vi.fn().mockResolvedValue(undefined),
      onCreateLimitCycleFromOrbit: vi.fn().mockResolvedValue(undefined),
      onCreateLimitCycleFromPD: vi.fn().mockResolvedValue(undefined),
      onCreateCycleFromPD: vi.fn().mockResolvedValue(undefined),
      onSetLimitCycleRenderTarget: onSetRenderTarget,
    }
    const branchView = render(
      <InspectorDetailsPanel
        {...commonProps}
        system={withBranch.system}
        selectedNodeId={withBranch.nodeId}
      />
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    const renderButton = await screen.findByTestId('branch-point-render-lc')
    expect(renderButton).toHaveTextContent('Render Forced Response Here')
    await user.click(renderButton)
    expect(onSetRenderTarget).toHaveBeenCalledWith(withResponse.nodeId, {
      type: 'branch',
      branchId: withBranch.nodeId,
      pointIndex: 0,
    })

    branchView.unmount()
    const targetedSystem = structuredClone(withBranch.system)
    targetedSystem.ui.limitCycleRenderTargets = {
      [withResponse.nodeId]: {
        type: 'branch',
        branchId: withBranch.nodeId,
        pointIndex: 0,
      },
    }
    render(
      <InspectorDetailsPanel
        {...commonProps}
        system={targetedSystem}
        selectedNodeId={withResponse.nodeId}
      />
    )

    expect(screen.getByTestId('forced-response-render-target')).toHaveTextContent(
      'forced_a @ 7'
    )
    const restoreButton = screen.getByTestId('forced-response-render-stored')
    expect(restoreButton).toHaveTextContent('Render stored response')
    await user.click(restoreButton)
    expect(onSetRenderTarget).toHaveBeenLastCalledWith(withResponse.nodeId, {
      type: 'object',
    })
  })

  it('validates adaptive mesh integers exactly and ignores stale disabled fields', () => {
    expect(
      buildCollocationAdaptivitySettings({
        adaptiveCollocationEnabled: true,
        adaptiveDefectTolerance: '0.025',
        adaptiveMaxRefinements: '3.5',
        adaptiveMaxMeshPoints: '512',
      })
    ).toBeNull()

    expect(
      buildCollocationAdaptivitySettings({
        adaptiveCollocationEnabled: false,
        adaptiveDefectTolerance: 'invalid',
        adaptiveMaxRefinements: '3.5',
        adaptiveMaxMeshPoints: 'invalid',
      })
    ).toEqual({
      enabled: false,
      redistribution_enabled: true,
      defect_tolerance: 0.025,
      max_refinements: 3,
      max_mesh_points: 512,
    })
  })

  it('shows collocation mesh adaptation provenance in the branch summary', async () => {
    const user = userEvent.setup()
    const fixture = createStateSpaceStrideBranchFixture('lpc_curve')
    const sourceBranch = fixture.system.branches[fixture.nodeId]
    const system = updateBranch(fixture.system, fixture.nodeId, {
      ...sourceBranch,
      data: {
        ...sourceBranch.data,
        collocation_adaptation: {
          initial_mesh_points: 4,
          current_mesh_points: 6,
          degree: 2,
          defect_tolerance: 0.025,
          refinement_budget: 3,
          max_mesh_points: 64,
          initial_normalized_mesh: [0, 0.25, 0.5, 0.75, 1],
          current_normalized_mesh: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1],
          attempts: [
            {
              sequence: 1,
              kind: 'refinement',
              old_mesh_points: 4,
              new_mesh_points: 6,
              degree: 2,
              trigger_defect: 0.2,
              tolerance: 0.025,
              interval_scaled_defects: [0.2, 0.01, 0.02, 0.15],
              old_normalized_mesh: [0, 0.25, 0.5, 0.75, 1],
              new_normalized_mesh: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1],
            },
          ],
        },
      },
    })

    renderInspectorForStateSpaceStride(system, fixture.nodeId, vi.fn())
    await user.click(screen.getByTestId('action-branch-summary-toggle'))

    expect(screen.getByTestId('collocation-adaptation-report')).toHaveTextContent(
      '4 → 6'
    )
    expect(screen.getByTestId('collocation-adaptation-report')).toHaveTextContent(
      'refinement: 4 → 6'
    )
  })

  it('renders independent endpoint spectra and unsupported heteroclinic channels', async () => {
    const user = userEvent.setup()
    const fixture = createStateSpaceStrideBranchFixture('heteroclinic_curve')
    const sourceBranch = fixture.system.branches[fixture.nodeId]
    const point = sourceBranch.data.points[0]
    const system = updateBranch(fixture.system, fixture.nodeId, {
      ...sourceBranch,
      data: {
        ...sourceBranch.data,
        points: [
          {
            ...point,
            heteroclinic_events: {
              source_stable_dimension: 1,
              source_unstable_dimension: 3,
              target_stable_dimension: 3,
              target_unstable_dimension: 1,
              source_discarded_eigenvalues: 0,
              target_discarded_eigenvalues: 0,
              source_eigenvalues: [{ re: 1, im: 0 }],
              target_eigenvalues: [{ re: -2, im: 0 }],
              inclination_transport: {
                source: {
                  ambient_dimension: 3,
                  frame_dimension: 2,
                  reference_dimension: 1,
                  principal_dimension: 2,
                  transported_frame: [1, 0, 0, 0, 1, 0],
                  reference_frame: [0.8, 0.6, 0],
                  exterior_orientation: [1, 0],
                  minimum_overlap_singular_value: 0.8,
                  gauge_invariant_overlap_volume: 0.8,
                  relative_transport_residual: 2e-9,
                },
                target: {
                  ambient_dimension: 3,
                  frame_dimension: 1,
                  transported_frame: [0, 1, 0],
                  reference_frame: [0, -1, 0],
                  minimum_overlap_singular_value: 1,
                  relative_transport_residual: 3e-9,
                },
              },
              events: [
                {
                  kind: 'SLC',
                  name: 'Source leading-spectrum collision',
                  value: -0.25,
                  status: 'available',
                  reason: null,
                },
                {
                  kind: 'XRS',
                  name: 'Cross-endpoint resonance',
                  value: null,
                  status: 'unsupported',
                  reason: 'a single open connection has no intrinsic analogue',
                },
                {
                  kind: 'SIF',
                  name: 'Source inclination flip',
                  value: 0.8,
                  status: 'available',
                  reason: null,
                },
                {
                  kind: 'TIF',
                  name: 'Target inclination flip',
                  value: -1,
                  status: 'available',
                  reason: null,
                },
              ],
            },
          },
        ],
      },
    })

    renderInspectorForStateSpaceStride(system, fixture.nodeId, vi.fn())
    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))
    await user.click(screen.getByTestId('branch-point-details-toggle'))

    const diagnostics = screen.getByTestId('heteroclinic-event-diagnostics')
    expect(diagnostics).toHaveTextContent('Source Morse dimensionsstable 1 · unstable 3')
    expect(diagnostics).toHaveTextContent('Target spectrum-2.0000e+0+0.0000e+0i')
    expect(diagnostics).toHaveTextContent(
      'SLC · Source leading-spectrum collisionavailable · value -2.500000e-1'
    )
    expect(diagnostics).toHaveTextContent(
      'XRS · Cross-endpoint resonanceunsupported · value unavailable'
    )
    expect(diagnostics).toHaveTextContent(
      'Source inclination transport3D · transported 2 · reference 1 · principal block 2 · minimum physical overlap 8.000000e-1 · exterior volume 8.000000e-1 · relative residual 2.000000e-9'
    )
    expect(diagnostics).toHaveTextContent(
      'Target inclination transport3D · transported 1 · reference 1 · principal block 1 · minimum physical overlap 1.000000e+0 · exterior volume 1.000000e+0 · relative residual 3.000000e-9'
    )
    expect(diagnostics).toHaveTextContent(
      'SIF · Source inclination flipavailable · value 8.000000e-1'
    )
    expect(diagnostics).toHaveTextContent(
      'TIF · Target inclination flipavailable · value -1.000000e+0'
    )
    expect(screen.queryByTestId('homoclinic-event-diagnostics')).toBeNull()
  })

  it.each([
    ['CycleFold', 'LimitPointCycle', 'LPC'],
    ['PeriodDoubling', 'PeriodDoubling', 'PD'],
    ['NeimarkSacker', 'NeimarkSacker', 'NS'],
  ] as const)(
    'exposes %s points as a %s curve workflow',
    async (stability, curveType, label) => {
      const user = userEvent.setup()
      const config: SystemConfig = {
        name: `Flow_${stability}_Inspector`,
        equations: ['-y + mu*x', 'x + nu*y'],
        params: [0.2, 0.4],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      }
      const base = createSystem({ name: config.name, config })
      const limitCycle: LimitCycleObject = {
        type: 'limit_cycle',
        name: `LC_${stability}`,
        systemName: config.name,
        origin: { type: 'orbit', orbitName: 'Orbit_1' },
        ntst: 1,
        ncol: 1,
        period: 6,
        state: [1, 0, 0, 1, 6],
        parameters: [...config.params],
        parameterName: 'mu',
        paramValue: 0.2,
        floquetMultipliers: [],
        createdAt: new Date().toISOString(),
      }
      const withObject = addObject(base, limitCycle)
      const branch: ContinuationObject = {
        type: 'continuation',
        name: `lc_${stability}_mu`,
        systemName: config.name,
        parameterName: 'mu',
        parentObject: limitCycle.name,
        startObject: limitCycle.name,
        branchType: 'limit_cycle',
        data: {
          points: [
            {
              state: [1, 0, 0, 1, 6],
              param_value: 0.25,
              stability,
              eigenvalues:
                stability === 'NeimarkSacker'
                  ? [
                      { re: 0.5, im: 0.866 },
                      { re: 0.5, im: -0.866 },
                    ]
                  : [],
            },
          ],
          bifurcations: [0],
          indices: [0],
          branch_type: { type: 'LimitCycle', ntst: 1, ncol: 1 },
        },
        settings: continuationSettings,
        timestamp: new Date().toISOString(),
        params: [...config.params],
      }
      const fixture = addBranch(withObject.system, branch, withObject.nodeId)
      const onCreate = vi.fn().mockResolvedValue(undefined)
      renderInspectorForStateSpaceStride(
        fixture.system,
        fixture.nodeId,
        vi.fn(),
        vi.fn(),
        vi.fn(),
        onCreate
      )

      await user.click(screen.getByTestId('action-branch-points-toggle'))
      await user.click(screen.getByTestId('branch-bifurcation-0'))
      await user.click(screen.getByTestId('inspector-workflow-back'))

      expect(screen.getByTestId('action-limit-cycle-codim1-curve-toggle')).toHaveTextContent(
        `${label} curve`
      )
      await user.click(screen.getByTestId('action-limit-cycle-codim1-curve-toggle'))
      expect(
        screen.getByTestId('limit-cycle-codim1-curve-adaptive-collocation-enabled')
      ).toBeChecked()
      await user.clear(screen.getByTestId('limit-cycle-codim1-curve-name'))
      await user.type(screen.getByTestId('limit-cycle-codim1-curve-name'), `${label}_mu_nu`)
      await user.selectOptions(screen.getByTestId('limit-cycle-codim1-curve-param2'), 'nu')
      await user.click(screen.getByTestId('limit-cycle-codim1-curve-submit'))

      expect(onCreate).toHaveBeenCalledWith({
        branchId: fixture.nodeId,
        pointIndex: 0,
        curveType,
        name: `${label}_mu_nu`,
        param2Name: 'nu',
        settings: {
          step_size: 0.01,
          min_step_size: 1e-5,
          max_step_size: 0.1,
          max_steps: 300,
          corrector_steps: 10,
          corrector_tolerance: 1e-8,
          step_tolerance: 1e-8,
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
    }
  )

  it('exposes an available NSNS alternate curve and forwards its secondary cosine', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Flow_NSNS_Inspector',
      equations: ['-y + mu*x', 'x + nu*y'],
      params: [0.2, 0.4],
      paramNames: ['mu', 'nu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow',
    }
    const base = createSystem({ name: config.name, config })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_NSNS',
      systemName: config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_1' },
      ntst: 1,
      ncol: 1,
      period: 6,
      state: [1, 0, 0, 1, 6],
      parameters: [...config.params],
      parameterName: 'mu',
      paramValue: 0.2,
      floquetMultipliers: [],
      createdAt: new Date().toISOString(),
    }
    const withObject = addObject(base, limitCycle)
    const codim2: Codim2PointData = {
      type: 'DoubleNeimarkSacker',
      refined: true,
      candidate: false,
      test_function: 'secondary_unit_pair_modulus',
      test_function_value: 0,
      residual_norm: 2e-9,
      iterations: 4,
      tolerance: 1e-8,
      source_segment: [0, 1],
      source_test_values: [-0.1, 0.1],
      method: 'bracketed_newton',
      coefficients: [{ name: 'secondary_unit_pair_cosine', value: 0.25 }],
      conditioning: {},
      branch_switches: [
        { target: 'NeimarkSacker', available: true, target_auxiliary: 0.25 },
      ],
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'ns_curve_mu_nu',
      systemName: config.name,
      parameterName: 'mu, nu',
      parameterRef: { kind: 'native_param', name: 'mu' },
      parameter2Ref: { kind: 'native_param', name: 'nu' },
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'ns_curve',
      data: {
        points: [
          {
            state: [1, 0, 0, 1, 1, 0, 6],
            param_value: 0.25,
            param2_value: 0.45,
            stability: 'DoubleNeimarkSacker',
            eigenvalues: [],
            codim2,
            codim2_events: [codim2],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: {
          type: 'NSCurve',
          param1_name: 'mu',
          param2_name: 'nu',
          ntst: 1,
          ncol: 1,
          normalized_mesh: [0, 1],
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...config.params],
    }
    const fixture = addBranch(withObject.system, branch, withObject.nodeId)
    const onCreate = vi.fn().mockResolvedValue(undefined)
    renderInspectorForStateSpaceStride(
      fixture.system,
      fixture.nodeId,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      onCreate
    )

    await user.click(screen.getByTestId('action-branch-points-toggle'))
    await user.click(screen.getByTestId('branch-bifurcation-0'))
    await user.click(screen.getByTestId('inspector-workflow-back'))

    expect(screen.getByTestId('action-limit-cycle-codim1-curve-toggle')).toHaveTextContent(
      'NS curve'
    )
    await user.click(screen.getByTestId('action-limit-cycle-codim1-curve-toggle'))
    expect(screen.getByTestId('limit-cycle-codim1-curve-target')).toHaveValue(
      'NeimarkSacker'
    )
    await user.clear(screen.getByTestId('limit-cycle-codim1-curve-name'))
    await user.type(screen.getByTestId('limit-cycle-codim1-curve-name'), 'nsns_secondary')
    await user.selectOptions(screen.getByTestId('limit-cycle-codim1-curve-param2'), 'nu')
    await user.click(screen.getByTestId('limit-cycle-codim1-curve-submit'))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: fixture.nodeId,
        pointIndex: 0,
        curveType: 'NeimarkSacker',
        targetAuxiliary: 0.25,
        name: 'nsns_secondary',
        param2Name: 'nu',
      })
    )
  })

  it('hides orbit result menus until an orbit has been run', () => {
    const baseSystem = createSystem({
      name: 'Empty_Orbit_Inspector',
      config: {
        name: 'Empty_Orbit_Inspector',
        equations: ['y', '-x'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Empty',
      systemName: baseSystem.config.name,
      data: [],
      t_start: 0,
      t_end: 0,
      dt: 0.01,
      parameters: [...baseSystem.config.params],
    }
    const added = addObject(baseSystem, orbit)

    renderInspectorForStateSpaceStride(added.system, added.nodeId, vi.fn())

    expect(screen.getByTestId('orbit-run-toggle')).toBeVisible()
    expect(screen.queryByTestId('orbit-data-toggle')).toBeNull()
    expect(screen.queryByTestId('oseledets-toggle')).toBeNull()
    expect(screen.queryByTestId('limit-cycle-toggle')).toBeNull()
  })

  it('orders Orbit Simulation before every orbit-dependent menu', () => {
    const baseSystem = createSystem({
      name: 'Populated_Orbit_Inspector',
      config: {
        name: 'Populated_Orbit_Inspector',
        equations: ['y', '-x'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Populated',
      systemName: baseSystem.config.name,
      data: [
        [0, 1, 0],
        [0.01, 0.99, -0.01],
      ],
      t_start: 0,
      t_end: 0.01,
      dt: 0.01,
      parameters: [...baseSystem.config.params],
    }
    const added = addObject(baseSystem, orbit)

    renderInspectorForStateSpaceStride(added.system, added.nodeId, vi.fn())

    const simulation = screen.getByTestId('orbit-run-toggle')
    for (const dependentTestId of [
      'orbit-data-toggle',
      'oseledets-toggle',
      'limit-cycle-toggle',
    ]) {
      const dependent = screen.getByTestId(dependentTestId)
      expect(
        simulation.compareDocumentPosition(dependent) & Node.DOCUMENT_POSITION_FOLLOWING
      ).not.toBe(0)
    }
  })

  it('preserves Lyapunov drafts when orbit analysis results update', () => {
    const baseSystem = createSystem({
      name: 'Lyapunov_Draft_Lifecycle',
      config: {
        name: 'Lyapunov_Draft_Lifecycle',
        equations: ['y', '-x'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Lyapunov',
      systemName: baseSystem.config.name,
      data: [
        [0, 1, 0],
        [20, 0, 1],
      ],
      t_start: 0,
      t_end: 20,
      dt: 0.01,
      parameters: [...baseSystem.config.params],
    }
    const added = addObject(baseSystem, orbit)
    const renderPanel = (system: System) => (
      <InspectorDetailsPanel
        system={system}
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

    const rendered = render(renderPanel(added.system))
    fireEvent.click(screen.getByTestId('oseledets-toggle'))
    fireEvent.change(screen.getByTestId('lyapunov-transient'), {
      target: { value: '12' },
    })
    fireEvent.change(screen.getByTestId('lyapunov-qr'), { target: { value: '5' } })
    fireEvent.change(screen.getByTestId('clv-transient'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('clv-forward'), { target: { value: '4' } })
    fireEvent.change(screen.getByTestId('clv-backward'), { target: { value: '6' } })
    fireEvent.change(screen.getByTestId('clv-qr'), { target: { value: '7' } })

    const withResults = updateObject(added.system, added.nodeId, {
      lyapunovExponents: [0.1, -0.1],
    })
    rendered.rerender(renderPanel(withResults))

    expect(screen.getByTestId('lyapunov-transient')).toHaveValue(12)
    expect(screen.getByTestId('lyapunov-qr')).toHaveValue(5)
    expect(screen.getByTestId('clv-transient')).toHaveValue(3)
    expect(screen.getByTestId('clv-forward')).toHaveValue(4)
    expect(screen.getByTestId('clv-backward')).toHaveValue(6)
    expect(screen.getByTestId('clv-qr')).toHaveValue(7)
  })

  it('hides equilibrium result menus until the equilibrium has been solved', () => {
    const baseSystem = createSystem({
      name: 'Empty_Equilibrium_Inspector',
      config: {
        name: 'Empty_Equilibrium_Inspector',
        equations: ['y', '-x'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Equilibrium_Empty',
      systemName: baseSystem.config.name,
      parameters: [...baseSystem.config.params],
    }
    const added = addObject(baseSystem, equilibrium)

    renderInspectorForStateSpaceStride(added.system, added.nodeId, vi.fn())

    expect(screen.getByTestId('action-equilibrium-solver-toggle')).toBeVisible()
    expect(screen.queryByTestId('action-equilibrium-data-toggle')).toBeNull()
    expect(screen.queryByTestId('action-equilibrium-continuation-toggle')).toBeNull()
    expect(screen.queryByTestId('action-equilibrium-manifold-toggle')).toBeNull()
  })

  it('routes equilibrium panels through the Actions menu', () => {
    const baseSystem = createSystem({
      name: 'Solved_Equilibrium_Inspector',
      config: {
        name: 'Solved_Equilibrium_Inspector',
        equations: ['y', '-x'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Equilibrium_Solved',
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

    renderInspectorForStateSpaceStride(added.system, added.nodeId, vi.fn())

    for (const actionTestId of [
      'action-equilibrium-solver-toggle',
      'action-equilibrium-data-toggle',
      'action-equilibrium-continuation-toggle',
      'action-equilibrium-manifold-toggle',
    ]) {
      expect(screen.getByTestId(actionTestId)).toBeVisible()
    }
    for (const panelTestId of [
      'equilibrium-solver-toggle',
      'equilibrium-data-toggle',
      'equilibrium-continuation-toggle',
      'equilibrium-manifold-toggle',
    ]) {
      expect(screen.getByTestId(panelTestId).closest('details')).toHaveClass(
        'inspector-disclosure--action-only'
      )
    }
  })

  it('hides limit-cycle manifolds until Floquet multipliers exist', () => {
    const baseSystem = createSystem({
      name: 'Empty_Limit_Cycle_Inspector',
      config: {
        name: 'Empty_Limit_Cycle_Inspector',
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
      name: 'Limit_Cycle_Empty',
      systemName: baseSystem.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Seed' },
      ntst: 1,
      ncol: 1,
      period: 1,
      state: [1, 0, 1],
      parameters: [...baseSystem.config.params],
      createdAt: new Date().toISOString(),
    }
    const added = addObject(baseSystem, limitCycle)

    renderInspectorForStateSpaceStride(added.system, added.nodeId, vi.fn())

    expect(screen.getByTestId('limit-cycle-data-toggle')).toBeVisible()
    expect(screen.queryByTestId('limit-cycle-manifold-toggle')).toBeNull()
  })

  it('nests Point Details inside Branch Navigator', async () => {
    const user = userEvent.setup()
    const branchResult = createStateSpaceStrideBranchFixture('homoclinic_curve')

    renderInspectorForStateSpaceStride(branchResult.system, branchResult.nodeId, vi.fn())

    expect(screen.getByTestId('action-branch-summary-toggle')).toHaveTextContent('View Summary')
    expect(screen.getByTestId('action-branch-points-toggle')).toHaveTextContent('View Data')
    expect(screen.getByTestId('inspector-name')).toBeVisible()
    await user.click(screen.getByTestId('action-branch-points-toggle'))
    expect(screen.queryByTestId('inspector-name')).toBeNull()

    const navigatorToggle = screen.getByTestId('branch-points-toggle')
    const navigatorDetails = navigatorToggle.closest('details')
    expect(navigatorDetails).toHaveClass('inspector-disclosure--action-only')

    const pointToggle = screen.getByTestId('branch-point-details-toggle')
    const pointDetails = pointToggle.closest('details')
    expect(pointDetails).toBeTruthy()
    expect(pointDetails).not.toBe(navigatorDetails)
    expect(navigatorDetails?.contains(pointDetails)).toBe(true)
  })

  it('shows selected two-parameter continuation values in the branch navigator', async () => {
    const user = userEvent.setup()
    const branchResult = createStateSpaceStrideBranchFixture('homoclinic_curve')

    renderInspectorForStateSpaceStride(branchResult.system, branchResult.nodeId, vi.fn())

    await user.click(screen.getByTestId('branch-points-toggle'))

    expect(
      screen.getByText('Continuation parameters: mu=0.200000, nu=0.100000')
    ).toBeVisible()
  })

  it('shows codimension-two refinement diagnostics for a selected branch point', async () => {
    const user = userEvent.setup()
    const onCreateCodim2BranchFromPoint = vi.fn().mockResolvedValue(undefined)
    const branchResult = createStateSpaceStrideBranchFixture('homoclinic_curve')
    const sourceBranch = branchResult.system.branches[branchResult.nodeId]
    const sourcePoint = sourceBranch.data.points[0]
    const primaryCodim2: Codim2PointData = {
      type: 'GeneralizedHopf',
      refined: true,
      candidate: false,
      test_function: 'first_lyapunov_coefficient',
      test_function_value: 2e-11,
      residual_norm: 3e-10,
      iterations: 5,
      tolerance: 1e-9,
      source_segment: [3, 4],
      source_test_values: [-0.2, 0.1],
      method: 'bracketed_newton',
      coefficients: [
        { name: 'l1', value: 0.0125 },
        { name: 'l2', value: 0.75 },
      ],
      conditioning: {
        bordered_condition_number: 120,
        jacobian_condition_number: 80,
      },
      branch_switches: [
        {
          target: 'NeimarkSacker',
          available: true,
          target_auxiliary: 0.5,
        },
        {
          target: 'LimitPointCycle',
          available: false,
          reason: 'A higher-order predictor is required.',
        },
      ],
      certification: {
        defining_conditions_verified: true,
        nondegeneracy_evaluated: true,
        nondegenerate: true,
      },
    }
    const simultaneousEvent: Codim2PointData = {
      ...primaryCodim2,
      type: 'DoubleHopf',
      test_function: 'second imaginary pair',
      test_function_value: -4e-12,
      coefficients: [],
      branch_switches: [],
    }
    const system = updateBranch(branchResult.system, branchResult.nodeId, {
      ...sourceBranch,
      data: {
        ...sourceBranch.data,
        points: [
          {
            ...sourcePoint,
            stability: 'GeneralizedHopf',
            codim2: primaryCodim2,
            codim2_events: [primaryCodim2, simultaneousEvent],
          },
        ],
      },
    })

    renderInspectorForStateSpaceStride(
      system,
      branchResult.nodeId,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      onCreateCodim2BranchFromPoint
    )

    await user.click(screen.getByTestId('branch-points-toggle'))
    await user.click(screen.getByTestId('branch-point-details-toggle'))

    expect(screen.getByText('Codimension-two refinement')).toBeVisible()
    expect(screen.getAllByText('GeneralizedHopf')).toHaveLength(2)
    expect(screen.getByText('Refined')).toBeVisible()
    expect(screen.getByText('first_lyapunov_coefficient')).toBeVisible()
    expect(screen.getByText('2.0000e-11')).toBeVisible()
    expect(screen.getByText('3.0000e-10')).toBeVisible()
    expect(screen.getByText('bracketed_newton')).toBeVisible()
    expect(screen.getByText('3 to 4')).toBeVisible()
    expect(screen.getByText('-2.0000e-1 to 1.0000e-1')).toBeVisible()
    expect(screen.getByText('Normal-form coefficients')).toBeVisible()
    expect(screen.getByText('l1')).toBeVisible()
    expect(screen.getByText('1.2500e-2')).toBeVisible()
    expect(screen.getByText('Bordered condition number')).toBeVisible()
    expect(screen.getByText('1.2000e+2')).toBeVisible()
    expect(screen.getByText('Jacobian condition number')).toBeVisible()
    expect(screen.getByText('8.0000e+1')).toBeVisible()
    expect(screen.getByText('Adjacent cycle curves')).toBeVisible()
    expect(screen.getByText('Available (auxiliary 5.0000e-1)')).toBeVisible()
    expect(screen.getByText('Unavailable — A higher-order predictor is required.')).toBeVisible()
    expect(screen.getByText('Certification')).toBeVisible()
    expect(screen.getByText('Verified nondegenerate')).toBeVisible()
    expect(screen.getByText('Simultaneous codimension-two events')).toBeVisible()
    expect(screen.getByText(/second imaginary pair=-4\.0000e-12/)).toBeVisible()
    expect(screen.getByTestId('codim2-switch-lpc')).toBeVisible()
    await user.click(screen.getByTestId('codim2-switch-lpc'))
    expect(onCreateCodim2BranchFromPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'LimitPointCycle',
        settings: expect.objectContaining({ max_steps: 50 }),
      })
    )
  })
})
