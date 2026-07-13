import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { NormalFormWorkflow } from './NormalFormWorkflow'

function scope(overrides: Record<string, unknown>): InspectorSelectionController {
  return {
    InspectorDisclosure: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    InspectorMetrics: ({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) => (
      <dl>{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    ),
    branchPointIndex: 2,
    existingBranchNames: [],
    onComputeNormalFormAtPoint: vi.fn(),
    onCreateCodim2BranchFromPoint: vi.fn(),
    onCreatePeriodicBranchFromPoint: vi.fn(),
    runDisabled: false,
    selectedNodeId: 'branch-1',
    selectionKey: 'branch-1',
    suggestDefaultName: () => 'secondary_branch',
    systemDraft: { type: 'flow' },
    ...overrides,
  } as unknown as InspectorSelectionController
}

describe('NormalFormWorkflow', () => {
  it('renders nothing when no continuation point is selected', () => {
    const { container } = render(<NormalFormWorkflow scope={scope({
      branch: undefined,
      branchPointIndex: null,
      selectedBranchPoint: undefined,
      selectedNodeId: null,
    })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('computes a map normal form from the selected product UI point', () => {
    const compute = vi.fn()
    render(<NormalFormWorkflow scope={scope({
      systemDraft: { type: 'map' },
      branch: {
        name: 'fixed_points',
        branchType: 'equilibrium',
        data: { points: [] },
      },
      selectedBranchPoint: { state: [0], param_value: 0, stability: 'PeriodDoubling' },
      onComputeNormalFormAtPoint: compute,
    })} />)

    fireEvent.click(screen.getByTestId('compute-normal-form'))
    expect(compute).toHaveBeenCalledWith({ branchId: 'branch-1', pointIndex: 2 })
  })

  it('exposes generic periodic BP switching only after a classified normal form', () => {
    const create = vi.fn()
    render(<NormalFormWorkflow scope={scope({
      branch: {
        name: 'cycles',
        branchType: 'limit_cycle',
        data: {
          points: [],
          branch_type: { type: 'LimitCycle', ntst: 2, ncol: 2, normalized_mesh: [0, 0.3, 1] },
        },
      },
      selectedBranchPoint: {
        state: [0, 0, 1],
        param_value: 0,
        stability: 'BranchPoint',
        normal_form: {
          source_kind: 'PeriodicOrbit',
          source_branch_id: 'branch-1',
          source_point_index: 2,
          parameter_names: ['mu'],
          parameter_values: [0],
          normalized_mesh: [0, 0.3, 1],
          computed_at: '2026-07-13T00:00:00.000Z',
          normal_form: {
            type: 'BranchPoint',
            kind: 'Pitchfork',
            constant_parameter_coefficient: 0,
            linear_parameter_coefficient: 1,
            quadratic_coefficient: 0,
            cubic_coefficient: -1,
            critical_mode: [1],
            conditioning: {
              eigenvector_pairing: 1,
              right_residual: 0,
              left_residual: 0,
              homological_residual: 0,
              return_map_residual: 0,
              section_residual: 0,
              return_time_correction: 0,
              section_transversality: 1,
            },
          },
        },
      },
      onCreatePeriodicBranchFromPoint: create,
    })} />)

    expect(screen.getByTestId('normal-form-readout')).toHaveTextContent('Pitchfork')
    fireEvent.click(screen.getByTestId('switch-periodic-bp'))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      branchId: 'branch-1',
      pointIndex: 2,
      name: 'secondary_branch',
      amplitude: 0.05,
    }))
  })

  it('preserves a signed periodic BP predictor amplitude', () => {
    const create = vi.fn()
    render(<NormalFormWorkflow scope={scope({
      branch: {
        name: 'cycles',
        branchType: 'limit_cycle',
        data: {
          points: [],
          branch_type: { type: 'LimitCycle', ntst: 2, ncol: 2, normalized_mesh: [0, 0.3, 1] },
        },
      },
      selectedBranchPoint: {
        state: [0, 0, 1],
        param_value: 0,
        stability: 'BranchPoint',
        normal_form: {
          source_kind: 'PeriodicOrbit',
          source_branch_id: 'branch-1',
          source_point_index: 2,
          parameter_names: ['mu'],
          parameter_values: [0],
          normalized_mesh: [0, 0.3, 1],
          computed_at: '2026-07-13T00:00:00.000Z',
          normal_form: {
            type: 'BranchPoint',
            kind: 'Pitchfork',
            constant_parameter_coefficient: 0,
            linear_parameter_coefficient: 1,
            quadratic_coefficient: 0,
            cubic_coefficient: -1,
            critical_mode: [1],
            conditioning: {
              eigenvector_pairing: 1,
              right_residual: 0,
              left_residual: 0,
              homological_residual: 0,
              return_map_residual: 0,
              section_residual: 0,
              return_time_correction: 0,
              section_transversality: 1,
            },
          },
        },
      },
      onCreatePeriodicBranchFromPoint: create,
    })} />)

    fireEvent.change(screen.getByTestId('periodic-bp-amplitude'), {
      target: { value: '-0.05' },
    })
    fireEvent.click(screen.getByTestId('switch-periodic-bp'))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ amplitude: -0.05 }))
  })

  it('exposes Hopf-Hopf mode selection and a periodic NS target', () => {
    const create = vi.fn()
    render(<NormalFormWorkflow scope={scope({
      branch: {
        name: 'hopf_curve',
        branchType: 'hopf_curve',
        data: { points: [] },
      },
      selectedBranchPoint: {
        state: [0, 0, 0, 0],
        param_value: 0,
        param2_value: 0,
        stability: 'None',
        codim2: {
          type: 'DoubleHopf',
          refined: true,
          candidate: false,
          branch_switches: [],
        },
      },
      onCreateCodim2BranchFromPoint: create,
    })} />)

    fireEvent.change(screen.getByTestId('codim2-target'), { target: { value: 'NeimarkSacker' } })
    fireEvent.change(screen.getByTestId('codim2-mode'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('switch-equilibrium-codim2'))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      target: 'NeimarkSacker',
      mode: 2,
      ntst: 20,
      ncol: 4,
    }))
  })

  it('rejects fractional periodic NS mesh sizes instead of truncating them', () => {
    const create = vi.fn()
    render(<NormalFormWorkflow scope={scope({
      branch: {
        name: 'hopf_curve',
        branchType: 'hopf_curve',
        data: { points: [] },
      },
      selectedBranchPoint: {
        state: [0, 0, 0, 0],
        param_value: 0,
        param2_value: 0,
        stability: 'None',
        codim2: {
          type: 'DoubleHopf',
          refined: true,
          candidate: false,
          branch_switches: [],
        },
      },
      onCreateCodim2BranchFromPoint: create,
    })} />)

    fireEvent.change(screen.getByTestId('codim2-target'), {
      target: { value: 'NeimarkSacker' },
    })
    fireEvent.change(screen.getByTestId('codim2-ntst'), { target: { value: '20.5' } })
    fireEvent.click(screen.getByTestId('switch-equilibrium-codim2'))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByText(/mesh intervals must be an integer/i)).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('codim2-ntst'), { target: { value: '20' } })
    fireEvent.change(screen.getByTestId('codim2-ncol'), { target: { value: '4.25' } })
    fireEvent.click(screen.getByTestId('switch-equilibrium-codim2'))
    expect(create).not.toHaveBeenCalled()
  })

  it('disables both branch-switch actions while runs are disabled', () => {
    const periodicPoint = {
      state: [0, 0, 1],
      param_value: 0,
      stability: 'BranchPoint',
      normal_form: {
        source_kind: 'PeriodicOrbit',
        source_branch_id: 'branch-1',
        source_point_index: 2,
        parameter_names: ['mu'],
        parameter_values: [0],
        normalized_mesh: [0, 0.3, 1],
        computed_at: '2026-07-13T00:00:00.000Z',
        normal_form: {
          type: 'BranchPoint',
          kind: 'Pitchfork',
          constant_parameter_coefficient: 0,
          linear_parameter_coefficient: 1,
          quadratic_coefficient: 0,
          cubic_coefficient: -1,
          critical_mode: [1],
          conditioning: {
            eigenvector_pairing: 1,
            right_residual: 0,
            left_residual: 0,
            homological_residual: 0,
            return_map_residual: 0,
            section_residual: 0,
            return_time_correction: 0,
            section_transversality: 1,
          },
        },
      },
    }
    const { rerender } = render(<NormalFormWorkflow scope={scope({
      runDisabled: true,
      branch: {
        name: 'cycles',
        branchType: 'limit_cycle',
        data: {
          points: [],
          branch_type: {
            type: 'LimitCycle',
            ntst: 2,
            ncol: 2,
            normalized_mesh: [0, 0.3, 1],
          },
        },
      },
      selectedBranchPoint: periodicPoint,
    })} />)
    expect(screen.getByTestId('switch-periodic-bp')).toBeDisabled()

    rerender(<NormalFormWorkflow scope={scope({
      runDisabled: true,
      branch: { name: 'hopf_curve', branchType: 'hopf_curve', data: { points: [] } },
      selectedBranchPoint: {
        state: [0, 0, 0, 0],
        param_value: 0,
        param2_value: 0,
        stability: 'None',
        codim2: {
          type: 'DoubleHopf',
          refined: true,
          candidate: false,
          branch_switches: [],
        },
      },
    })} />)
    expect(screen.getByTestId('switch-equilibrium-codim2')).toBeDisabled()
  })

  it('keeps a legacy-mesh periodic BP switch disabled under its warning', () => {
    render(<NormalFormWorkflow scope={scope({
      branch: {
        name: 'cycles',
        branchType: 'limit_cycle',
        data: { points: [], branch_type: { type: 'LimitCycle', ntst: 2, ncol: 2 } },
      },
      selectedBranchPoint: {
        state: [0, 0, 1],
        param_value: 0,
        stability: 'BranchPoint',
        normal_form: {
          source_kind: 'PeriodicOrbit',
          source_branch_id: 'branch-1',
          source_point_index: 2,
          parameter_names: ['mu'],
          parameter_values: [0],
          normalized_mesh: [0, 0.3, 1],
          computed_at: '2026-07-13T00:00:00.000Z',
          normal_form: {
            type: 'BranchPoint',
            kind: 'Pitchfork',
            constant_parameter_coefficient: 0,
            linear_parameter_coefficient: 1,
            quadratic_coefficient: 0,
            cubic_coefficient: -1,
            critical_mode: [1],
            conditioning: {
              eigenvector_pairing: 1,
              right_residual: 0,
              left_residual: 0,
              homological_residual: 0,
              return_map_residual: 0,
              section_residual: 0,
              return_time_correction: 0,
              section_transversality: 1,
            },
          },
        },
      },
    })} />)
    expect(screen.getByTestId('normal-form-mesh-warning')).toBeInTheDocument()
    expect(screen.getByTestId('switch-periodic-bp')).toBeDisabled()
  })

  it('does not leak source-branch provenance when selection moves to another point', () => {
    const provenance = {
      source_kind: 'Map' as const,
      source_branch_id: 'branch-1',
      source_point_index: 2,
      parameter_names: ['mu'],
      parameter_values: [0],
      computed_at: '2026-07-13T00:00:00.000Z',
      normal_form: {
        type: 'PeriodDoubling' as const,
        parameter_coefficient: 1,
        cubic_coefficient: -1,
        criticality: 'Supercritical' as const,
        conditioning: {
          eigenvector_pairing: 1,
          right_residual: 0,
          left_residual: 0,
          homological_residual: 0,
        },
      },
    }
    const branch = {
      name: 'fixed_points',
      branchType: 'equilibrium',
      data: { points: [], normal_form_provenance: provenance },
    }
    const { rerender } = render(<NormalFormWorkflow scope={scope({
      systemDraft: { type: 'map' },
      branch,
      selectedBranchPoint: {
        state: [0],
        param_value: 0,
        stability: 'PeriodDoubling',
        normal_form: provenance,
      },
    })} />)
    expect(screen.getByTestId('normal-form-readout')).toBeInTheDocument()

    rerender(<NormalFormWorkflow scope={scope({
      systemDraft: { type: 'map' },
      branchPointIndex: 3,
      branch,
      selectedBranchPoint: {
        state: [0.1],
        param_value: 0.1,
        stability: 'PeriodDoubling',
      },
    })} />)
    expect(screen.queryByTestId('normal-form-readout')).not.toBeInTheDocument()
  })

  it.each([
    { source_branch_id: 'fixed_points' },
    { source_branch_id: 'cli-legacy-id', source_branch: 'fixed_points' },
  ])('does not leak CLI source-branch provenance to every point (%o)', (sourceIdentity) => {
    const provenance = {
      source_kind: 'Map' as const,
      ...sourceIdentity,
      source_point_index: 2,
      parameter_names: ['mu'],
      parameter_values: [0],
      computed_at: '2026-07-13T00:00:00.000Z',
      normal_form: {
        type: 'PeriodDoubling' as const,
        parameter_coefficient: 1,
        cubic_coefficient: -1,
        criticality: 'Supercritical' as const,
        conditioning: {
          eigenvector_pairing: 1,
          right_residual: 0,
          left_residual: 0,
          homological_residual: 0,
        },
      },
    }
    render(<NormalFormWorkflow scope={scope({
      systemDraft: { type: 'map' },
      branch: {
        name: 'fixed_points',
        branchType: 'equilibrium',
        data: { points: [], normal_form_provenance: provenance },
      },
      selectedBranchPoint: {
        state: [0.1],
        param_value: 0.1,
        stability: 'PeriodDoubling',
      },
    })} />)
    expect(screen.queryByTestId('normal-form-readout')).not.toBeInTheDocument()
  })

  it('disables Zero-Hopf NS switching from refined metadata before normal-form computation', () => {
    render(<NormalFormWorkflow scope={scope({
      branch: { name: 'hopf_curve', branchType: 'hopf_curve', data: { points: [] } },
      selectedBranchPoint: {
        state: [0, 0, 0],
        param_value: 0,
        param2_value: 0,
        stability: 'None',
        codim2: {
          type: 'ZeroHopf',
          refined: true,
          candidate: false,
          coefficients: [{ name: 'has_ns', value: 0 }],
          branch_switches: [],
        },
      },
    })} />)
    expect(screen.getByTestId('zero-hopf-ns-unavailable')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Periodic NS curve' })).toBeDisabled()
  })

  it('does not expose codim2 switching for an unrefined candidate', () => {
    render(<NormalFormWorkflow scope={scope({
      branch: { name: 'hopf_curve', branchType: 'hopf_curve', data: { points: [] } },
      selectedBranchPoint: {
        state: [0, 0, 0, 0],
        param_value: 0,
        param2_value: 0,
        stability: 'None',
        codim2: {
          type: 'DoubleHopf',
          refined: false,
          candidate: true,
          coefficients: [],
        },
      },
    })} />)
    expect(screen.queryByTestId('equilibrium-codim2-switch-form')).not.toBeInTheDocument()
    expect(screen.getByTestId('compute-normal-form')).toBeInTheDocument()
  })
})
