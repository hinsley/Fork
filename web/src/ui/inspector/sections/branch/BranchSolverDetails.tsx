import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { CalculationDiagnosticSummary } from '../../CalculationDiagnosticSummary'
import { fmt, fmtSci } from '../../../../utils/format'

function formatAdaptationTermination(reason: string): string {
  return reason.replaceAll('_', ' ')
}

/** Closed-by-default solver metadata: settings, adaptation, manifold diagnostics. */
export function BranchSolverDetails({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorMetrics,
    branch,
    formatNumberSafe,
    formatScientific,
    formatTerminationReasonLabel,
    isLimitCycleBranch,
    limitCycleMesh,
    manifoldCurveSolverDiagnostics,
    manifoldSolverDiagnostics,
    manifoldSurfaceGeometry,
    manifoldSurfaceRingCount,
    manifoldSurfaceVertexCount,
  } = scope
  if (!branch) return null
  return (
    <details className="branch-solver">
      <summary data-testid="branch-summary-toggle">Solver details</summary>
      <div className="branch-solver__content">
        {branch.data.termination ? (
          <CalculationDiagnosticSummary diagnostic={branch.data.termination} partial />
        ) : null}
        <div className="inspector-section">
          <InspectorMetrics
            rows={[
              { label: 'Parent', value: branch.parentObject },
              { label: 'Start', value: branch.startObject },
              ...(isLimitCycleBranch
                ? [{ label: 'Mesh', value: `${limitCycleMesh.ntst} x ${limitCycleMesh.ncol}` }]
                : []),
              ...(branch.branchType === 'heteroclinic_curve'
                ? [
                    {
                      label: 'Source equilibrium',
                      value:
                        branch.heteroclinicEndpoints?.sourceObjectName ?? 'unknown',
                    },
                    {
                      label: 'Target equilibrium',
                      value:
                        branch.heteroclinicEndpoints?.targetObjectName ?? 'unknown',
                    },
                    ...(
                      branch.data.branch_type?.type === 'HeteroclinicCurve'
                        ? [
                            {
                              label: 'Schema',
                              value: `v${branch.data.branch_type.schema.schema_version}`,
                            },
                            {
                              label: 'Method',
                              value:
                                branch.data.branch_type.discretization?.type ===
                                'shooting'
                                  ? branch.data.branch_type.ntst === 1
                                    ? 'Single shooting'
                                    : 'Multiple shooting'
                                  : 'Orthogonal collocation',
                            },
                            {
                              label:
                                branch.data.branch_type.discretization?.type ===
                                'shooting'
                                  ? 'Shooting intervals'
                                  : 'Mesh',
                              value:
                                branch.data.branch_type.discretization?.type ===
                                'shooting'
                                  ? branch.data.branch_type.ntst
                                  : `${branch.data.branch_type.ntst} x ${branch.data.branch_type.ncol}`,
                            },
                            {
                              label: 'Source unstable dimension',
                              value: branch.data.branch_type.schema.source_basis.npos,
                            },
                            {
                              label: 'Target stable dimension',
                              value: branch.data.branch_type.schema.target_basis.nneg,
                            },
                          ]
                        : []
                    ),
                  ]
                : []),
              ...(branch.data.codim2_seed
                ? [
                    { label: 'Predictor residual', value: formatScientific(branch.data.codim2_seed.predictor_residual, 4) },
                    { label: 'Corrected residual', value: formatScientific(branch.data.codim2_seed.corrected_residual, 4) },
                  ]
                : []),
              ...(manifoldSurfaceGeometry
                ? [
                    { label: 'Surface rings', value: manifoldSurfaceRingCount },
                    { label: 'Surface vertices', value: manifoldSurfaceVertexCount },
                  ]
                : []),
              ...(manifoldSolverDiagnostics
                ? [
                    {
                      label: 'Termination',
                      value: formatTerminationReasonLabel(
                        manifoldSolverDiagnostics.termination_reason
                      ),
                    },
                    {
                      label: 'Final leaf delta',
                      value: formatScientific(
                        manifoldSolverDiagnostics.final_leaf_delta ?? Number.NaN,
                        3
                      ),
                    },
                  ]
                : []),
              ...(manifoldCurveSolverDiagnostics
                ? [
                    {
                      label: 'Termination',
                      value: formatTerminationReasonLabel(
                        manifoldCurveSolverDiagnostics.termination_reason
                      ),
                    },
                    {
                      label: 'Arclength',
                      value: `${formatNumberSafe(manifoldCurveSolverDiagnostics.achieved_arclength)} / ${formatNumberSafe(manifoldCurveSolverDiagnostics.requested_arclength)}`,
                    },
                    {
                      label: 'Target reached',
                      value: manifoldCurveSolverDiagnostics.target_reached
                        ? 'yes'
                        : 'no',
                    },
                    {
                      label: 'Extensions',
                      value: manifoldCurveSolverDiagnostics.extension_count ?? 0,
                    },
                  ]
                : []),
            ]}
          />
        </div>
        {branch.settings && typeof branch.settings === 'object' ? (
          <div className="inspector-section">
            <h4 className="inspector-subheading">Continuation settings</h4>
            <InspectorMetrics
              rows={[
                {
                  label: 'Step size',
                  value: fmt((branch.settings as { step_size?: number }).step_size),
                },
                {
                  label: 'Min step',
                  value: fmt((branch.settings as { min_step_size?: number })
                      .min_step_size),
                },
                {
                  label: 'Max step',
                  value: fmt((branch.settings as { max_step_size?: number })
                      .max_step_size),
                },
                {
                  label: 'Max points',
                  value:
                    (branch.settings as { max_steps?: number }).max_steps ?? '—',
                },
                {
                  label: 'Corrector steps',
                  value:
                    (branch.settings as { corrector_steps?: number })
                      .corrector_steps ?? '—',
                },
                {
                  label: 'Corrector tol',
                  value: fmtSci((branch.settings as { corrector_tolerance?: number })
                      .corrector_tolerance),
                },
                {
                  label: 'Step tol',
                  value: fmtSci((branch.settings as { step_tolerance?: number })
                      .step_tolerance),
                },
              ]}
            />
          </div>
        ) : null}
        {branch.data.collocation_adaptation ? (
          <div
            className="inspector-section"
            data-testid="collocation-adaptation-report"
          >
            <h4 className="inspector-subheading">Collocation adaptation</h4>
            <InspectorMetrics
              rows={[
                {
                  label: 'Mesh intervals',
                  value: `${branch.data.collocation_adaptation.initial_mesh_points} → ${branch.data.collocation_adaptation.current_mesh_points}`,
                },
                {
                  label: 'Collocation degree',
                  value: branch.data.collocation_adaptation.degree,
                },
                {
                  label: 'Defect tolerance',
                  value: formatScientific(
                    branch.data.collocation_adaptation.defect_tolerance,
                    4
                  ),
                },
                {
                  label: 'Adaptations',
                  value: branch.data.collocation_adaptation.attempts.length,
                },
                ...branch.data.collocation_adaptation.attempts.map((attempt) => ({
                  label: `Attempt ${attempt.sequence}`,
                  value: `${attempt.kind}: ${attempt.old_mesh_points} → ${attempt.new_mesh_points} (defect ${formatScientific(attempt.trigger_defect, 4)})`,
                })),
                ...(branch.data.collocation_adaptation.termination
                  ? [
                      {
                        label: 'Termination',
                        value: `${formatAdaptationTermination(
                          branch.data.collocation_adaptation.termination.reason
                        )} at defect ${formatScientific(
                          branch.data.collocation_adaptation.termination
                            .measured_defect,
                          4
                        )}`,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        ) : null}
        {manifoldSolverDiagnostics ? (
          <div className="inspector-section">
            <h4 className="inspector-subheading">Manifold solver diagnostics</h4>
            <InspectorMetrics
              rows={[
                {
                  label: 'Ring attempts',
                  value: manifoldSolverDiagnostics.ring_attempts ?? 0,
                },
                {
                  label: 'Leaf build failures',
                  value: manifoldSolverDiagnostics.build_failures ?? 0,
                },
                {
                  label: 'Leaf fail: plane no-convergence',
                  value: manifoldSolverDiagnostics.leaf_fail_plane_no_convergence ?? 0,
                },
                {
                  label: 'Leaf fail: root not bracketed',
                  value:
                    manifoldSolverDiagnostics.leaf_fail_plane_root_not_bracketed ?? 0,
                },
                {
                  label: 'Legacy leaf fail: segment switch limit',
                  value: manifoldSolverDiagnostics.leaf_fail_segment_switch_limit ?? 0,
                },
                {
                  label: 'Leaf fail: integrator non-finite',
                  value: manifoldSolverDiagnostics.leaf_fail_integrator_non_finite ?? 0,
                },
                {
                  label: 'Leaf fail: no first hit before max time',
                  value:
                    manifoldSolverDiagnostics.leaf_fail_no_first_hit_within_max_time ??
                    0,
                },
                {
                  label: 'Per-leaf delta reductions',
                  value: manifoldSolverDiagnostics.local_leaf_shrinks ?? 0,
                },
                {
                  label: 'Spacing failures',
                  value: manifoldSolverDiagnostics.spacing_failures ?? 0,
                },
                {
                  label: 'Ring-quality rejects',
                  value: manifoldSolverDiagnostics.reject_ring_quality ?? 0,
                },
                {
                  label: 'Geodesic rejects',
                  value: manifoldSolverDiagnostics.reject_geodesic_quality ?? 0,
                },
                {
                  label: 'Too-small candidates',
                  value: manifoldSolverDiagnostics.reject_too_small ?? 0,
                },
                {
                  label: 'Leaf delta floor',
                  value: formatScientific(
                    manifoldSolverDiagnostics.leaf_delta_floor ?? Number.NaN,
                    3
                  ),
                },
                {
                  label: 'Min leaf delta reached',
                  value: manifoldSolverDiagnostics.min_leaf_delta_reached ? 'yes' : 'no',
                },
                ...(typeof manifoldSolverDiagnostics.failed_ring === 'number'
                  ? [
                      {
                        label: 'Failed ring',
                        value: manifoldSolverDiagnostics.failed_ring,
                      },
                    ]
                  : []),
                ...(typeof manifoldSolverDiagnostics.failed_attempt === 'number'
                  ? [
                      {
                        label: 'Failed attempt',
                        value: manifoldSolverDiagnostics.failed_attempt,
                      },
                    ]
                  : []),
                ...(typeof manifoldSolverDiagnostics.failed_leaf_points === 'number'
                  ? [
                      {
                        label: 'Solved leaf points before fail',
                        value: manifoldSolverDiagnostics.failed_leaf_points,
                      },
                    ]
                  : []),
                ...(manifoldSolverDiagnostics.last_leaf_failure_reason
                  ? [
                      {
                        label: 'Last leaf failure reason',
                        value: manifoldSolverDiagnostics.last_leaf_failure_reason,
                      },
                    ]
                  : []),
                ...(typeof manifoldSolverDiagnostics.last_leaf_failure_point === 'number'
                  ? [
                      {
                        label: 'Last leaf failure point',
                        value: manifoldSolverDiagnostics.last_leaf_failure_point,
                      },
                    ]
                  : []),
                ...(typeof manifoldSolverDiagnostics.last_leaf_failure_segment === 'number'
                  ? [
                      {
                        label: 'Last leaf failure segment',
                        value: manifoldSolverDiagnostics.last_leaf_failure_segment,
                      },
                    ]
                  : []),
                ...(typeof manifoldSolverDiagnostics.last_leaf_failure_time === 'number'
                  ? [
                      {
                        label: 'Last leaf failure time',
                        value: formatScientific(
                          manifoldSolverDiagnostics.last_leaf_failure_time,
                          3
                        ),
                      },
                    ]
                  : []),
                ...(typeof manifoldSolverDiagnostics.last_leaf_failure_tau === 'number'
                  ? [
                      {
                        label: 'Last leaf failure tau',
                        value: formatScientific(
                          manifoldSolverDiagnostics.last_leaf_failure_tau,
                          3
                        ),
                      },
                    ]
                  : []),
                {
                  label: 'Last ring max turn angle',
                  value: formatScientific(
                    manifoldSolverDiagnostics.last_ring_max_turn_angle ?? Number.NaN,
                    3
                  ),
                },
                {
                  label: 'Last ring max distance-angle',
                  value: formatScientific(
                    manifoldSolverDiagnostics.last_ring_max_distance_angle ??
                      Number.NaN,
                    3
                  ),
                },
                {
                  label: 'Last geodesic max angle',
                  value: formatScientific(
                    manifoldSolverDiagnostics.last_geodesic_max_angle ?? Number.NaN,
                    3
                  ),
                },
                {
                  label: 'Last geodesic max distance-angle',
                  value: formatScientific(
                    manifoldSolverDiagnostics.last_geodesic_max_distance_angle ??
                      Number.NaN,
                    3
                  ),
                },
              ]}
            />
            {manifoldSolverDiagnostics.termination_detail ? (
              <div className="inspector-data">
                <div>{manifoldSolverDiagnostics.termination_detail}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  )
}
