import {
  render, screen, waitFor, within,
  userEvent, describe, expect, it,
  vi, createDemoSystem, InspectorDetailsPanel, addBranch,
  addObject, createSystem, continuationSettings, type ContinuationObject,
  type EquilibriumObject, type IsoclineObject, type LimitCycleObject, type OrbitObject,
  type SystemConfig,
} from './InspectorDetailsPanel.testSupport'

describe('InspectorDetailsPanel: orbits and continuation workflows', () => {
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

    const modelToggle = screen.getByTestId('system-toggle-model')
    await user.click(modelToggle)
    expect(modelToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('system-name')).toBeNull()
    await user.click(modelToggle)

    const variablesToggle = screen.getByTestId('system-toggle-variables')
    await user.click(variablesToggle)
    expect(screen.queryByTestId('system-var-0')).toBeNull()
    await user.click(variablesToggle)

    const parametersToggle = screen.getByTestId('system-toggle-parameters')
    await user.click(parametersToggle)
    expect(screen.queryByTestId('system-param-0')).toBeNull()
    await user.click(parametersToggle)

    const nameInput = screen.getByTestId('system-name')
    await user.clear(nameInput)
    await user.type(nameInput, 'NewSystem')
    await user.click(screen.getByTestId('system-type-map'))
    expect(screen.queryByTestId('system-solver')).toBeNull()

    await user.click(screen.getByTestId('system-apply'))

    expect(onUpdateSystem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'NewSystem', type: 'map', solver: 'discrete' })
    )
  })

  it('only shows a variable period field when periodic is enabled', async () => {
    const user = userEvent.setup()
    const { system } = createDemoSystem()

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

    expect(screen.queryByTestId('system-periodic-period-0')).toBeNull()

    await user.click(screen.getByTestId('system-periodic-enabled-0'))
    expect(screen.getByTestId('system-periodic-period-0')).toHaveValue(
      `${Math.PI * 2}`
    )

    await user.click(screen.getByTestId('system-periodic-enabled-0'))
    expect(screen.queryByTestId('system-periodic-period-0')).toBeNull()
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
      initialContext: 0,
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
    await user.click(screen.getByTestId('orbit-data-preview-toggle'))

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
    await user.click(screen.getByTestId('limit-cycle-data-preview-toggle'))

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
        collocation_adaptivity: {
          enabled: true,
          redistribution_enabled: true,
          defect_tolerance: 0.025,
          max_refinements: 3,
          max_mesh_points: 512,
        },
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
      expect(branchInput).toHaveAttribute('placeholder', 'LC_PD_pt1_mu_beta')
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

    await user.click(screen.getByTestId('action-equilibrium-continuation-toggle'))
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

    await user.click(screen.getByTestId('action-equilibrium-continuation-toggle'))
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

    await user.click(screen.getByTestId('action-equilibrium-continuation-toggle'))
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

    await user.click(screen.getByTestId('action-equilibrium-continuation-toggle'))
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

  it('shows and submits "Continue Isoperiodic Curve" for limit-cycle branches', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'Isoperiodic_Menu_System',
      config: {
        name: 'Isoperiodic_Menu_System',
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
      name: 'LC_Isoperiodic',
      systemName: baseSystem.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Isoperiodic' },
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
      name: 'lc_isoperiodic_seed_mu',
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
    const onCreateIsoperiodicCurveFromPoint = vi.fn().mockResolvedValue(undefined)

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
        onCreateIsoperiodicCurveFromPoint={onCreateIsoperiodicCurveFromPoint}
      />
    )

    const isoperiodicAction = screen.getByTestId('action-isoperiodic-curve-toggle')
    const isoperiodicActionGroup = isoperiodicAction.closest('.inspector-actions__group')
    expect(isoperiodicActionGroup).not.toBeNull()
    expect(
      within(isoperiodicActionGroup as HTMLElement).getByRole('heading', {
        name: 'Continuation',
      })
    ).toBeInTheDocument()

    await user.click(screen.getByTestId('isoperiodic-curve-toggle'))
    await user.clear(screen.getByTestId('isoperiodic-curve-name'))
    await user.type(screen.getByTestId('isoperiodic-curve-name'), 'iso_curve_nu_mu')
    expect(screen.getByTestId('isoperiodic-curve-param1')).toHaveValue('mu')
    await user.selectOptions(screen.getByTestId('isoperiodic-curve-param1'), 'nu')
    await user.selectOptions(screen.getByTestId('isoperiodic-curve-param2'), 'mu')
    await user.selectOptions(screen.getByTestId('isoperiodic-curve-direction'), 'backward')
    await user.click(screen.getByTestId('isoperiodic-curve-submit'))

    expect(onCreateIsoperiodicCurveFromPoint).toHaveBeenCalledWith(
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

  it('shows "Continue from Point" for isoperiodic curve branches and submits continuation', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({
      name: 'Isoperiodic_From_Isoperiodic_Menu_System',
      config: {
        name: 'Isoperiodic_From_Isoperiodic_Menu_System',
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
      name: 'LC_Isoperiodic_Source',
      systemName: baseSystem.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Isoperiodic_Source' },
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
      name: 'isoperiodic_seed_mu_nu',
      systemName: baseSystem.config.name,
      parameterName: 'mu, nu',
      parentObject: limitCycle.name,
      startObject: 'lc_iso_seed',
      branchType: 'isoperiodic_curve',
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
          type: 'IsoperiodicCurve',
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
    const onCreateIsoperiodicCurveFromPoint = vi.fn().mockResolvedValue(undefined)

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
        onCreateIsoperiodicCurveFromPoint={onCreateIsoperiodicCurveFromPoint}
      />
    )

    expect(screen.getByTestId('isoperiodic-curve-toggle')).toHaveTextContent('Continue from Point')
    await user.click(screen.getByTestId('isoperiodic-curve-toggle'))
    await user.clear(screen.getByTestId('isoperiodic-curve-name'))
    await user.type(screen.getByTestId('isoperiodic-curve-name'), 'iso_curve_kappa_mu')
    expect(screen.getByTestId('isoperiodic-curve-param1')).toHaveValue('mu')
    await user.selectOptions(screen.getByTestId('isoperiodic-curve-param1'), 'kappa')
    await user.selectOptions(screen.getByTestId('isoperiodic-curve-param2'), 'mu')
    await user.click(screen.getByTestId('isoperiodic-curve-submit'))

    expect(onCreateIsoperiodicCurveFromPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'iso_curve_kappa_mu',
        parameterName: 'kappa',
        param2Name: 'mu',
      })
    )
  })

  it('hides "Continue Isoperiodic Curve" outside limit-cycle branch context', () => {
    const baseSystem = createSystem({ name: 'Isoperiodic_Hidden_System' })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Isoperiodic_Hidden',
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
        onCreateIsoperiodicCurveFromPoint={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.queryByTestId('isoperiodic-curve-toggle')).toBeNull()
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

    await user.click(screen.getByTestId('branch-points-toggle'))
    expect(screen.getByText('Point Details')).toBeVisible()
    await user.click(screen.getByTestId('branch-point-details-toggle'))

    expect(screen.getByText('Amplitude (min to max)')).toBeVisible()
    expect(screen.getByText('Mean & RMS')).toBeVisible()
    expect(screen.getByText('Floquet Multipliers')).toBeVisible()
    expect(screen.getByTestId('branch-eigenvalue-plot')).toBeVisible()
  })
})
