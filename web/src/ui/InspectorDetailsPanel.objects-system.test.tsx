import {
  fireEvent, render, screen, waitFor,
  within, userEvent, describe, expect,
  it, vi, createDemoSystem, createPeriodDoublingSystem,
  InspectorDetailsPanel, makeSurfaceProfileDefaults, toManifold2DProfile, useState,
  addBranch, addObject, createSystem, renameNode,
  toggleNodeVisibility, updateNodeRender, buildSubsystemSnapshot, continuationSettings,
  stateSpaceStrideCycleLikeBranchTypes, createStateSpaceStrideBranchFixture, renderInspectorForStateSpaceStride, type ContinuationObject,
  type EquilibriumObject, type IsoclineObject, type OrbitObject, type SystemConfig,
} from './InspectorDetailsPanel.testSupport'

describe('InspectorDetailsPanel: objects, parameters, and system editing', () => {
  it('maps 2D manifold profile draft values explicitly', () => {
    expect(toManifold2DProfile('adaptive_global')).toBe('AdaptiveGlobal')
    expect(toManifold2DProfile('local_preview')).toBe('LocalPreview')
    expect(toManifold2DProfile('lorenz_global')).toBe('LorenzGlobalKo')

    const adaptive = makeSurfaceProfileDefaults('adaptive_global')
    const lorenz = makeSurfaceProfileDefaults('lorenz_global')
    expect(adaptive.maxSpacing).toBe('0.5')
    expect(lorenz.maxSpacing).toBe('2.0')
  })

  it('offers map-cycle manifold extension without unrelated surface caps', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Map_Manifold_Extension_Inspector',
      equations: ['2 * x'],
      params: [],
      paramNames: [],
      varNames: ['x'],
      solver: 'discrete',
      type: 'map',
    }
    const base = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Cycle_2',
      systemName: config.name,
    }
    const withEquilibrium = addObject(base, equilibrium)
    const caps = {
      max_steps: 80,
      max_points: 200,
      max_rings: 1,
      max_vertices: 1,
      max_time: 10,
      max_iterations: 60,
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'cycle_manifold_p2_plus',
      systemName: config.name,
      parameterName: 'manifold',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_1d',
      data: {
        points: [
          { state: [0.01], param_value: 0, stability: 'None', eigenvalues: [] },
          { state: [0.1], param_value: 0.09, stability: 'None', eigenvalues: [] },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: {
          type: 'ManifoldEq1D',
          stability: 'Unstable',
          direction: 'Plus',
          eig_index: 0,
          method: 'test',
          caps,
          map_iterations: 2,
          cycle_point_index: 1,
        },
        manifold_geometry: {
          type: 'Curve',
          dim: 1,
          points_flat: [0.01, 0.1],
          arclength: [0, 0.09],
          direction: 'Plus',
        },
      },
      settings: continuationSettings,
      manifoldSettings: {
        stability: 'Unstable',
        direction: 'Plus',
        eig_index: 0,
        eps: 0.01,
        target_arclength: 0.09,
        integration_dt: 1,
        caps,
      },
      timestamp: new Date().toISOString(),
      mapIterations: 2,
    }
    const fixture = addBranch(withEquilibrium.system, branch, withEquilibrium.nodeId)
    const onExtend = vi.fn().mockResolvedValue(undefined)

    renderInspectorForStateSpaceStride(
      fixture.system,
      fixture.nodeId,
      vi.fn(),
      onExtend
    )

    await user.click(screen.getByTestId('manifold-extend-toggle'))
    expect(screen.getByTestId('manifold-extend-max-iterations')).toBeVisible()
    expect(screen.queryByText('Max vertices')).not.toBeInTheDocument()
    expect(screen.queryByTestId('manifold-extend-integration-dt')).not.toBeInTheDocument()
    await user.clear(screen.getByTestId('manifold-extend-arclength'))
    await user.type(screen.getByTestId('manifold-extend-arclength'), '0.25')
    await user.click(screen.getByTestId('manifold-extend-submit'))

    await waitFor(() => {
      expect(onExtend).toHaveBeenCalledWith(
        expect.objectContaining({
          branchId: fixture.nodeId,
          settings: expect.objectContaining({
            stability: 'Unstable',
            direction: 'Plus',
            eig_index: 0,
            target_arclength: 0.25,
            integration_dt: 1,
          }),
        })
      )
    })
  })

  it('offers ring and vertex budgets when extending a 2D manifold', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Surface_Extension_Inspector',
      equations: ['x', 'y', '-z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    const base = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Surface',
      systemName: config.name,
    }
    const added = addObject(base, equilibrium)
    const caps = {
      max_steps: 80,
      max_points: 200,
      max_rings: 12,
      max_vertices: 400,
      max_time: 10,
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'surface',
      systemName: config.name,
      parameterName: 'manifold',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_2d',
      data: {
        points: [{ state: [0, 0, 0], param_value: 0, stability: 'None', eigenvalues: [] }],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'ManifoldEq2D',
          stability: 'Unstable',
          eig_kind: 'RealPair',
          eig_indices: [0, 1],
          method: 'krauskopf_osinga_geodesic_leaf_continuation',
          caps,
        },
      },
      settings: continuationSettings,
      manifoldSettings: {
        stability: 'Unstable',
        eig_indices: [0, 1],
        initial_radius: 0.01,
        leaf_delta: 0.01,
        delta_min: 0.001,
        ring_points: 8,
        min_spacing: 0.001,
        max_spacing: 0.02,
        alpha_min: 0.3,
        alpha_max: 0.4,
        delta_alpha_min: 0.1,
        delta_alpha_max: 1,
        integration_dt: 0.01,
        target_radius: 1,
        target_arclength: 0.1,
        caps,
      },
      timestamp: new Date().toISOString(),
    }
    const fixture = addBranch(added.system, branch, added.nodeId)
    const onExtend2D = vi.fn().mockResolvedValue(undefined)

    renderInspectorForStateSpaceStride(
      fixture.system,
      fixture.nodeId,
      vi.fn(),
      vi.fn(),
      onExtend2D
    )

    await user.click(screen.getByTestId('manifold-extend-toggle'))
    expect(screen.getByTestId('manifold-extend-max-rings')).toBeVisible()
    expect(screen.getByTestId('manifold-extend-max-vertices')).toBeVisible()
    expect(screen.queryByTestId('manifold-extend-max-points')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('manifold-extend-submit'))

    expect(onExtend2D).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: fixture.nodeId,
        targetArclength: 0.1,
        integrationDt: 0.01,
        caps: expect.objectContaining({ max_rings: 12, max_vertices: 400 }),
      })
    )
  })

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

    await user.click(screen.getByTestId('action-appearance-toggle'))
    expect(screen.getByTestId('appearance-section')).toBeVisible()
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

  it('toggles 2D manifold surface rendering from the branch inspector', async () => {
    const user = userEvent.setup()
    const config: SystemConfig = {
      name: 'Inspector_Surface_Toggle',
      equations: ['y', '-x', '-z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    const baseSystem = createSystem({ name: config.name, config })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Surface_Toggle',
      systemName: config.name,
    }
    const withEquilibrium = addObject(baseSystem, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_surface_toggle',
      systemName: config.name,
      parameterName: 'manifold',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_2d',
      data: {
        points: [],
        bifurcations: [],
        indices: [],
        branch_type: {
          type: 'ManifoldEq2D',
          stability: 'Stable',
          eig_kind: 'RealPair',
          eig_indices: [0, 1],
          method: 'leaf_shooting_bvp',
          caps: {
            max_steps: 64,
            max_points: 128,
            max_rings: 8,
            max_vertices: 512,
            max_time: 10,
          },
        },
        manifold_geometry: {
          type: 'Surface',
          dim: 3,
          vertices_flat: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          triangles: [0, 1, 2],
          ring_offsets: [0],
          ring_diagnostics: [],
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [],
    }
    const withBranch = addBranch(withEquilibrium.system, branch, withEquilibrium.nodeId)
    const onUpdateRender = vi.fn()

    function Wrapper() {
      const [state, setState] = useState(withBranch.system)
      return (
        <InspectorDetailsPanel
          system={state}
          selectedNodeId={withBranch.nodeId}
          view="selection"
          theme="light"
          onRename={vi.fn()}
          onToggleVisibility={vi.fn()}
          onUpdateRender={(id, render) => {
            onUpdateRender(id, render)
            setState((prev) => updateNodeRender(prev, id, render))
          }}
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

    const toggle = screen.getByTestId('inspector-manifold-surface-toggle')
    expect(toggle).toHaveTextContent('Hide surface')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await user.click(toggle)
    expect(onUpdateRender).toHaveBeenLastCalledWith(withBranch.nodeId, {
      manifoldSurfaceVisible: false,
    })
    expect(toggle).toHaveTextContent('Show surface')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)
    expect(onUpdateRender).toHaveBeenLastCalledWith(withBranch.nodeId, {
      manifoldSurfaceVisible: true,
    })
    expect(toggle).toHaveTextContent('Hide surface')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
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

    await user.click(screen.getByTestId('action-parameters-toggle'))
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

    await user.click(screen.getByTestId('action-frozen-variables-toggle'))
    const xFrozenValueInput = screen.getByTestId('frozen-variable-value-x')
    await user.clear(xFrozenValueInput)
    await user.type(xFrozenValueInput, '0.25')

    await waitFor(() =>
      expect(onUpdateObjectFrozenVariables).toHaveBeenLastCalledWith(nodeId, { x: 0.25 })
    )
  })

  it('shows and updates equation forcing context only for contextual equations', async () => {
    const user = userEvent.setup()
    const system = createSystem({
      name: 'Forced_Context',
      config: {
        name: 'Forced_Context',
        equations: ['t-x'],
        params: [],
        paramNames: [],
        varNames: ['x'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Forced_Orbit',
      systemName: system.config.name,
      data: [],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
    }
    const { system: next, nodeId } = addObject(system, orbit)
    const onUpdateObjectFrozenEquationContext = vi.fn()

    render(
      <InspectorDetailsPanel
        system={next}
        selectedNodeId={nodeId}
        view="selection"
        theme="light"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateObjectFrozenEquationContext={onUpdateObjectFrozenEquationContext}
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

    await user.click(screen.getByTestId('action-frozen-variables-toggle'))
    expect(screen.getByTestId('autonomous-context-warning')).toHaveTextContent(
      'Freeze the equation forcing context'
    )
    await user.click(screen.getByTestId('frozen-equation-context-toggle'))
    expect(onUpdateObjectFrozenEquationContext).toHaveBeenCalledWith(nodeId, {
      symbol: 't',
      value: 0,
    })
  })

  it('keeps matching frozen-context snapshots current and labels ctx:t for users', async () => {
    const user = userEvent.setup()
    const system = createSystem({
      name: 'Forced_Context_Snapshot',
      config: {
        name: 'Forced_Context_Snapshot',
        equations: ['t-x'],
        params: [],
        paramNames: [],
        varNames: ['x'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const frozenVariables = {
      frozenValuesByVarName: {},
      frozenEquationContext: { symbol: 't' as const, value: 1.5 },
    }
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Frozen_Context_Orbit',
      systemName: system.config.name,
      data: [[2, 0], [2.1, 0.1]],
      t_start: 2,
      t_end: 2.1,
      dt: 0.1,
      frozenVariables,
      subsystemSnapshot: buildSubsystemSnapshot(system.config, frozenVariables),
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

    expect(screen.queryByTestId('subsystem-mismatch-badge')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('action-limit-cycle-toggle'))
    expect(screen.getByLabelText('Continuation parameter')).toHaveDisplayValue(
      't (frozen forcing context)'
    )
  })

  it('explains why live forcing blocks autonomous orbit continuation', async () => {
    const user = userEvent.setup()
    const system = createSystem({
      name: 'Live_Forced_Context',
      config: {
        name: 'Live_Forced_Context',
        equations: ['t-x'],
        params: [],
        paramNames: [],
        varNames: ['x'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const { system: next, nodeId } = addObject(system, {
      type: 'orbit',
      name: 'Live_Forced_Orbit',
      systemName: system.config.name,
      data: [[0, 0], [0.1, 0.1]],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
    })

    render(
      <InspectorDetailsPanel
        system={next}
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

    await user.click(screen.getByTestId('action-limit-cycle-toggle'))
    expect(screen.getByTestId('autonomous-workflow-warning')).toHaveTextContent(
      'This system depends on t. Freeze the equation forcing context before running autonomous analysis.'
    )
    expect(screen.queryByTestId('limit-cycle-from-orbit-submit')).not.toBeInTheDocument()
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

    const header = screen.getByTestId('action-parameters-toggle')
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

    const header = screen.getByTestId('action-parameters-toggle')
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
})
