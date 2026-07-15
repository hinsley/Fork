import { useState } from 'react'
import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import type { HeteroclinicInclinationFrame } from '../../../../system/types'
import { InspectorSubDisclosure } from '../../selectionSession'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'
import {
  buildCollocationAdaptivitySettings,
  type CollocationAdaptivityDraft,
} from '../../collocationAdaptivity'

function formatAdaptationTermination(reason: string): string {
  return reason.replaceAll('_', ' ')
}

function formatInclinationFrame(
  frame: HeteroclinicInclinationFrame | null | undefined,
  formatScientific: (value: number, digits?: number) => string
): string {
  if (!frame) return 'unavailable'
  const referenceDimension = frame.reference_dimension ?? frame.frame_dimension
  const principalDimension = frame.principal_dimension ?? 1
  const exteriorVolume =
    frame.gauge_invariant_overlap_volume ?? frame.minimum_overlap_singular_value
  return `${frame.ambient_dimension}D · transported ${frame.frame_dimension} · reference ${referenceDimension} · principal block ${principalDimension} · minimum physical overlap ${formatScientific(frame.minimum_overlap_singular_value, 6)} · exterior volume ${formatScientific(exteriorVolume, 6)} · relative residual ${formatScientific(frame.relative_transport_residual, 6)}`
}

export function BranchDataSections({ scope }: { scope: InspectorSelectionController }) {
  const [btHomoclinicDraft, setBtHomoclinicDraft] = useState<
    CollocationAdaptivityDraft & {
      discretization: 'collocation' | 'shooting'
      shootingIntervals: string
      integrationStepsPerSegment: string
    }
  >({
    discretization: 'collocation',
    shootingIntervals: '8',
    integrationStepsPerSegment: '64',
  })
  const {
    BranchNavigatorContent,
    InspectorDisclosure,
    InspectorMetrics,
    PlotlyViewport,
    branch,
    branchBifurcations,
    branchCyclePoints,
    branchEigenPlot,
    branchEigenvalues,
    branchEndPoint,
    branchIndices,
    branchMultiplierPlot,
    branchNavigatorOpen,
    branchPointError,
    branchPointIndex,
    branchPointInput,
    branchSortedIndex,
    branchSortedOrder,
    branchStartPoint,
    formatBranchType,
    formatFixed,
    formatNumber,
    formatNumberSafe,
    formatPointValues,
    formatPolarValue,
    formatScientific,
    formatTerminationReasonLabel,
    frozenVariableHeaderNames,
    handleCreateCodim2Branch,
    handleJumpToBranchPoint,
    isBranchRenderTarget,
    isDiscreteMap,
    isLimitCycleBranch,
    limitCycleMesh,
    periodicOrbitParentId,
    limitCyclePointMetrics,
    manifoldCurveSolverDiagnostics,
    manifoldSolverDiagnostics,
    manifoldSurfaceGeometry,
    manifoldSurfaceRingCount,
    manifoldSurfaceVertexCount,
    onSetLimitCycleRenderTarget,
    selectedBranchPoint,
    selectedBranchPointParameterReadout,
    selectedBranchPointParams,
    selectedBranchPointState,
    selectedNodeId,
    selectionKey,
    setBranchNavigatorOpen,
    setBranchPoint,
    setBranchPointInput,
    systemDraft,
    writeClipboardText,
  } = scope
  if (!branch) return null
  return <>
{isLimitCycleBranch ? (
                  <>
                    <InspectorDisclosure
                      key={`${selectionKey}-lc-summary`}
                      title="Branch Summary"
                      testId="branch-summary-toggle"
                      actionOnly
                    >
                      <div className="inspector-section">
                        <InspectorMetrics
                          rows={[
                            { label: 'Type', value: formatBranchType(branch, systemDraft.type) },
                            { label: 'Parent', value: branch.parentObject },
                            { label: 'Start', value: branch.startObject },
                            { label: 'Continuation param', value: branch.parameterName },
                            {
                              label: 'Mesh',
                              value: `${limitCycleMesh.ntst} x ${limitCycleMesh.ncol}`,
                            },
                            { label: 'Points', value: branch.data.points.length },
                            { label: 'Bifurcations', value: branchBifurcations.length },
                            ...(branch.data.codim2_seed
                              ? [
                                  { label: 'Switched from', value: branch.data.codim2_seed.source_type },
                                  { label: 'Source point', value: branch.data.codim2_seed.source_point_index },
                                  { label: 'Predictor residual', value: formatScientific(branch.data.codim2_seed.predictor_residual, 4) },
                                  { label: 'Corrected residual', value: formatScientific(branch.data.codim2_seed.corrected_residual, 4) },
                                ]
                              : []),
                            ...(branchStartPoint
                              ? [
                                  {
                                    label: 'Start param value',
                                    value: formatNumber(branchStartPoint.param_value, 6),
                                  },
                                ]
                              : []),
                            ...(branchEndPoint
                              ? [
                                  {
                                    label: 'End param value',
                                    value: formatNumber(branchEndPoint.param_value, 6),
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
                                value: formatNumber(
                                  (branch.settings as { step_size?: number }).step_size ??
                                    Number.NaN,
                                  6
                                ),
                              },
                              {
                                label: 'Min step',
                                value: formatNumber(
                                  (branch.settings as { min_step_size?: number })
                                    .min_step_size ?? Number.NaN,
                                  6
                                ),
                              },
                              {
                                label: 'Max step',
                                value: formatNumber(
                                  (branch.settings as { max_step_size?: number })
                                    .max_step_size ?? Number.NaN,
                                  6
                                ),
                              },
                              {
                                label: 'Max points',
                                value:
                                  (branch.settings as { max_steps?: number }).max_steps ??
                                  Number.NaN,
                              },
                              {
                                label: 'Corrector steps',
                                value:
                                  (branch.settings as { corrector_steps?: number })
                                    .corrector_steps ?? Number.NaN,
                              },
                              {
                                label: 'Corrector tol',
                                value: formatScientific(
                                  (branch.settings as { corrector_tolerance?: number })
                                    .corrector_tolerance ?? Number.NaN,
                                  4
                                ),
                              },
                              {
                                label: 'Step tol',
                                value: formatScientific(
                                  (branch.settings as { step_tolerance?: number })
                                    .step_tolerance ?? Number.NaN,
                                  4
                                ),
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
                    </InspectorDisclosure>

                    <InspectorDisclosure
                      key={`${selectionKey}-branch-points`}
                      title="Branch Navigator"
                      testId="branch-points-toggle"
                      defaultOpen={false}
                      actionOnly
                      open={branchNavigatorOpen}
                      onOpenChange={setBranchNavigatorOpen}
                    >
                      <div className="inspector-section">
                        <BranchNavigatorContent
                          branch={branch}
                          branchIndices={branchIndices}
                          branchSortedOrder={branchSortedOrder}
                          branchSortedIndex={branchSortedIndex}
                          branchPointIndex={branchPointIndex}
                          branchPointInput={branchPointInput}
                          branchPointError={branchPointError}
                          selectedBranchPoint={selectedBranchPoint}
                          selectedBranchPointParameterReadout={
                            selectedBranchPointParameterReadout
                          }
                          selectedPointStability={
                            limitCyclePointMetrics?.stability ??
                            selectedBranchPoint?.stability
                          }
                          selectedPointPeriod={
                            limitCyclePointMetrics?.metrics.period ??
                            (selectedBranchPoint
                              ? selectedBranchPoint.state[
                                  selectedBranchPoint.state.length - 1
                                ]
                              : undefined)
                          }
                          branchBifurcations={branchBifurcations}
                          onPointSelect={setBranchPoint}
                          onPointInputChange={setBranchPointInput}
                          onJumpToPoint={handleJumpToBranchPoint}
                          onRenderPeriodicOrbitHere={
                            branchPointIndex !== null &&
                            selectedNodeId &&
                            periodicOrbitParentId &&
                            onSetLimitCycleRenderTarget &&
                            !isBranchRenderTarget
                              ? () =>
                                  onSetLimitCycleRenderTarget(periodicOrbitParentId, {
                                    type: 'branch',
                                    branchId: selectedNodeId,
                                    pointIndex: branchPointIndex,
                                  })
                              : undefined
                          }
                          renderPeriodicOrbitLabel={
                            branch.branchType === 'forced_periodic_response'
                              ? 'Render Forced Response Here'
                              : 'Render LC Here'
                          }
                        />
                        <InspectorSubDisclosure
                          title="Point Details"
                          testId="branch-point-details-toggle"
                        >
                          <div className="inspector-section">
                        {selectedBranchPoint ? (
                          <>
                            <InspectorMetrics
                              rows={[
                                {
                                  label: 'Stability',
                                  value:
                                    limitCyclePointMetrics?.stability ??
                                    selectedBranchPoint.stability,
                                },
                                {
                                  label: 'Period',
                                  value: formatNumber(
                                    limitCyclePointMetrics?.metrics.period ??
                                      selectedBranchPoint.state[
                                        selectedBranchPoint.state.length - 1
                                      ] ??
                                      Number.NaN,
                                    6
                                  ),
                                },
                              ]}
                            />
                            <div className="inspector-subheading-row">
                              <h4 className="inspector-subheading">Parameters</h4>
                              {selectedBranchPointParams.length > 0 ? (
                                <button
                                  type="button"
                                  className="inspector-inline-button"
                                  onClick={() =>
                                    void writeClipboardText(
                                      formatPointValues(selectedBranchPointParams)
                                    )
                                  }
                                >
                                  Copy
                                </button>
                              ) : null}
                            </div>
                            <InspectorMetrics
                              rows={systemDraft.paramNames.map((name, index) => ({
                                label: name || `p${index + 1}`,
                                value: formatNumber(
                                  selectedBranchPointParams[index] ?? Number.NaN,
                                  6
                                ),
                              }))}
                            />
                            <h4 className="inspector-subheading">
                              Amplitude (min to max)
                            </h4>
                            {limitCyclePointMetrics ? (
                              <InspectorMetrics
                                rows={limitCyclePointMetrics.metrics.ranges.map(
                                  (range, index) => ({
                                    label:
                                      frozenVariableHeaderNames[index] ||
                                      `x${index + 1}`,
                                    value: `${formatNumber(
                                      range.min,
                                      6
                                    )} to ${formatNumber(range.max, 6)} (${formatNumber(
                                      range.range,
                                      6
                                    )})`,
                                  })
                                )}
                              />
                            ) : (
                              <p className="empty-state">
                                Cycle metrics are not available for this point.
                              </p>
                            )}
                            <h4 className="inspector-subheading">Mean & RMS</h4>
                            {limitCyclePointMetrics ? (
                              <InspectorMetrics
                                rows={limitCyclePointMetrics.metrics.means.map(
                                  (mean, index) => ({
                                    label:
                                      frozenVariableHeaderNames[index] ||
                                      `x${index + 1}`,
                                    value: `mean ${formatNumber(
                                      mean,
                                      6
                                    )} · rms ${formatNumber(
                                      limitCyclePointMetrics.metrics.rmsAmplitudes[index],
                                      6
                                    )}`,
                                  })
                                )}
                              />
                            ) : null}
                            <div className="inspector-subheading-row">
                              <h4 className="inspector-subheading">State snapshot</h4>
                              {selectedBranchPoint.state.length > 0 ? (
                                <button
                                  type="button"
                                  className="inspector-inline-button"
                                  onClick={() =>
                                    void writeClipboardText(
                                      formatPointValues(selectedBranchPoint.state)
                                    )
                                  }
                                >
                                  Copy
                                </button>
                              ) : null}
                            </div>
                            <div className="inspector-data">
                              <div>Length: {selectedBranchPoint.state.length}</div>
                              <div>
                                Preview: [
                                {selectedBranchPoint.state
                                  .slice(0, Math.min(selectedBranchPoint.state.length, 8))
                                  .map((value) => formatFixed(value, 4))
                                  .join(', ')}
                                {selectedBranchPoint.state.length > 8 ? ', ...' : ''}]
                              </div>
                            </div>
                            <h4 className="inspector-subheading">Floquet Multipliers</h4>
                            {branchEigenvalues.length > 0 ? (
                              <div className="inspector-list">
                                {branchMultiplierPlot ? (
                                  <div className="inspector-plot">
                                    <PlotlyViewport
                                      plotId="branch-multiplier-plot"
                                      data={branchMultiplierPlot.data}
                                      layout={branchMultiplierPlot.layout}
                                      testId="branch-eigenvalue-plot"
                                    />
                                  </div>
                                ) : null}
                                <InspectorMetrics
                                  rows={branchEigenvalues.map((ev, index) => ({
                                    label: `λ${index + 1}`,
                                    value: isDiscreteMap
                                      ? `${formatNumberSafe(ev.re)} + ${formatNumberSafe(ev.im)}i (${formatPolarValue(ev)})`
                                      : `${formatNumberSafe(ev.re)} + ${formatNumberSafe(ev.im)}i`,
                                  }))}
                                />
                              </div>
                            ) : (
                              <p className="empty-state">
                                No multipliers stored for this point.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="empty-state">Select a point to inspect.</p>
                        )}
                          </div>
                        </InspectorSubDisclosure>
                      </div>
                    </InspectorDisclosure>
                  </>
                ) : (
                  <>
                    <InspectorDisclosure
                      key={`${selectionKey}-branch-summary`}
                      title="Branch Summary"
                      testId="branch-summary-toggle"
                      actionOnly
                    >
                      <div className="inspector-section">
                        <InspectorMetrics
                          rows={[
                            { label: 'Type', value: formatBranchType(branch, systemDraft.type) },
                            { label: 'Parent', value: branch.parentObject },
                            { label: 'Start', value: branch.startObject },
                            { label: 'Continuation param', value: branch.parameterName },
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
                            { label: 'Points', value: branch.data.points.length },
                            { label: 'Bifurcations', value: branchBifurcations.length },
                            ...(branch.data.codim2_seed
                              ? [
                                  { label: 'Switched from', value: branch.data.codim2_seed.source_type },
                                  { label: 'Source point', value: branch.data.codim2_seed.source_point_index },
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
                            ...(branchStartPoint
                              ? [
                                  {
                                    label: 'Start param value',
                                    value: formatNumber(branchStartPoint.param_value, 6),
                                  },
                                ]
                              : []),
                            ...(branchEndPoint
                              ? [
                                  {
                                    label: 'End param value',
                                    value: formatNumber(branchEndPoint.param_value, 6),
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
                                value: formatNumber(
                                  (branch.settings as { step_size?: number }).step_size ??
                                    Number.NaN,
                                  6
                                ),
                              },
                              {
                                label: 'Min step',
                                value: formatNumber(
                                  (branch.settings as { min_step_size?: number })
                                    .min_step_size ?? Number.NaN,
                                  6
                                ),
                              },
                              {
                                label: 'Max step',
                                value: formatNumber(
                                  (branch.settings as { max_step_size?: number })
                                    .max_step_size ?? Number.NaN,
                                  6
                                ),
                              },
                              {
                                label: 'Max points',
                                value:
                                  (branch.settings as { max_steps?: number }).max_steps ??
                                  Number.NaN,
                              },
                              {
                                label: 'Corrector steps',
                                value:
                                  (branch.settings as { corrector_steps?: number })
                                    .corrector_steps ?? Number.NaN,
                              },
                              {
                                label: 'Corrector tol',
                                value: formatScientific(
                                  (branch.settings as { corrector_tolerance?: number })
                                    .corrector_tolerance ?? Number.NaN,
                                  4
                                ),
                              },
                              {
                                label: 'Step tol',
                                value: formatScientific(
                                  (branch.settings as { step_tolerance?: number })
                                    .step_tolerance ?? Number.NaN,
                                  4
                                ),
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
                    </InspectorDisclosure>

                    <InspectorDisclosure
                      key={`${selectionKey}-branch-points`}
                      title="Branch Navigator"
                      testId="branch-points-toggle"
                      defaultOpen={false}
                      actionOnly
                      open={branchNavigatorOpen}
                      onOpenChange={setBranchNavigatorOpen}
                    >
                      <div className="inspector-section">
                        <BranchNavigatorContent
                          branch={branch}
                          branchIndices={branchIndices}
                          branchSortedOrder={branchSortedOrder}
                          branchSortedIndex={branchSortedIndex}
                          branchPointIndex={branchPointIndex}
                          branchPointInput={branchPointInput}
                          branchPointError={branchPointError}
                          selectedBranchPoint={selectedBranchPoint}
                          selectedBranchPointParameterReadout={
                            selectedBranchPointParameterReadout
                          }
                          selectedPointStability={selectedBranchPoint?.stability}
                          branchBifurcations={branchBifurcations}
                          onPointSelect={setBranchPoint}
                          onPointInputChange={setBranchPointInput}
                          onJumpToPoint={handleJumpToBranchPoint}
                          onRenderPeriodicOrbitHere={
                            branchPointIndex !== null &&
                            selectedNodeId &&
                            periodicOrbitParentId &&
                            onSetLimitCycleRenderTarget &&
                            !isBranchRenderTarget
                              ? () =>
                                  onSetLimitCycleRenderTarget(periodicOrbitParentId, {
                                    type: 'branch',
                                    branchId: selectedNodeId,
                                    pointIndex: branchPointIndex,
                                  })
                              : undefined
                          }
                          renderPeriodicOrbitLabel={
                            branch.branchType === 'forced_periodic_response'
                              ? 'Render Forced Response Here'
                              : 'Render LC Here'
                          }
                        />
                        <InspectorSubDisclosure
                          title="Point Details"
                          testId="branch-point-details-toggle"
                        >
                          <div className="inspector-section">
                        {selectedBranchPoint ? (
                          <>
                            <InspectorMetrics
                              rows={[
                                { label: 'Stability', value: selectedBranchPoint.stability },
                              ]}
                            />
                            {selectedBranchPoint.homoclinic_events ? (
                              <div data-testid="homoclinic-event-diagnostics">
                                <h4 className="inspector-subheading">
                                  Homoclinic event diagnostics
                                </h4>
                                <InspectorMetrics
                                  rows={[
                                    {
                                      label: 'Stable dimension',
                                      value:
                                        selectedBranchPoint.homoclinic_events
                                          .stable_dimension,
                                    },
                                    {
                                      label: 'Unstable dimension',
                                      value:
                                        selectedBranchPoint.homoclinic_events
                                          .unstable_dimension,
                                    },
                                    {
                                      label: 'Discarded eigenvalues',
                                      value:
                                        selectedBranchPoint.homoclinic_events
                                          .discarded_eigenvalues,
                                    },
                                  ]}
                                />
                                <InspectorMetrics
                                  rows={selectedBranchPoint.homoclinic_events.events.map(
                                    (event) => ({
                                      label: `${event.kind} · ${event.name}`,
                                      value: `${event.status}${
                                        event.value === null
                                          ? ' · value unavailable'
                                          : ` · value ${formatScientific(event.value, 6)}`
                                      } · reason ${event.reason ?? '—'}`,
                                    })
                                  )}
                                />
                              </div>
                            ) : null}
                            {selectedBranchPoint.heteroclinic_events ? (
                              <div data-testid="heteroclinic-event-diagnostics">
                                <h4 className="inspector-subheading">
                                  Heteroclinic connection event diagnostics
                                </h4>
                                <InspectorMetrics
                                  rows={[
                                    {
                                      label: 'Source Morse dimensions',
                                      value: `stable ${selectedBranchPoint.heteroclinic_events.source_stable_dimension} · unstable ${selectedBranchPoint.heteroclinic_events.source_unstable_dimension}`,
                                    },
                                    {
                                      label: 'Target Morse dimensions',
                                      value: `stable ${selectedBranchPoint.heteroclinic_events.target_stable_dimension} · unstable ${selectedBranchPoint.heteroclinic_events.target_unstable_dimension}`,
                                    },
                                    {
                                      label: 'Source spectrum',
                                      value: selectedBranchPoint.heteroclinic_events.source_eigenvalues
                                        .map(
                                          ({ re, im }) =>
                                            `${formatScientific(re, 4)}${im < 0 ? '' : '+'}${formatScientific(im, 4)}i`
                                        )
                                        .join(', '),
                                    },
                                    {
                                      label: 'Target spectrum',
                                      value: selectedBranchPoint.heteroclinic_events.target_eigenvalues
                                        .map(
                                          ({ re, im }) =>
                                            `${formatScientific(re, 4)}${im < 0 ? '' : '+'}${formatScientific(im, 4)}i`
                                        )
                                        .join(', '),
                                    },
                                  ]}
                                />
                                <InspectorMetrics
                                  rows={selectedBranchPoint.heteroclinic_events.events.map(
                                    (event) => ({
                                      label: `${event.kind} · ${event.name}`,
                                      value: `${event.status}${
                                        typeof event.value !== 'number' ||
                                        !Number.isFinite(event.value)
                                          ? ' · value unavailable'
                                          : ` · value ${formatScientific(event.value, 6)}`
                                      } · reason ${event.reason ?? '—'}`,
                                    })
                                  )}
                                />
                                {selectedBranchPoint.heteroclinic_events
                                  .inclination_transport ? (
                                  <InspectorMetrics
                                    rows={[
                                      {
                                        label: 'Source inclination transport',
                                        value: formatInclinationFrame(
                                          selectedBranchPoint.heteroclinic_events
                                            .inclination_transport.source,
                                          formatScientific
                                        ),
                                      },
                                      {
                                        label: 'Target inclination transport',
                                        value: formatInclinationFrame(
                                          selectedBranchPoint.heteroclinic_events
                                            .inclination_transport.target,
                                          formatScientific
                                        ),
                                      },
                                    ]}
                                  />
                                ) : null}
                              </div>
                            ) : null}
                            {selectedBranchPoint.codim2 ? (
                              <>
                                <h4 className="inspector-subheading">
                                  Codimension-two refinement
                                </h4>
                                <InspectorMetrics
                                  rows={[
                                    { label: 'Type', value: selectedBranchPoint.codim2.type },
                                    {
                                      label: 'Status',
                                      value:
                                        selectedBranchPoint.codim2.refined &&
                                        selectedBranchPoint.codim2.candidate
                                          ? 'Refined candidate'
                                          : selectedBranchPoint.codim2.refined
                                            ? 'Refined'
                                            : selectedBranchPoint.codim2.candidate
                                              ? 'Candidate'
                                              : 'Detected',
                                    },
                                    {
                                      label: 'Test function',
                                      value: selectedBranchPoint.codim2.test_function,
                                    },
                                    {
                                      label: 'Test residual',
                                      value: formatScientific(
                                        selectedBranchPoint.codim2.test_function_value,
                                        4
                                      ),
                                    },
                                    {
                                      label: 'Curve residual',
                                      value: formatScientific(
                                        selectedBranchPoint.codim2.residual_norm,
                                        4
                                      ),
                                    },
                                    {
                                      label: 'Iterations',
                                      value: selectedBranchPoint.codim2.iterations,
                                    },
                                    {
                                      label: 'Tolerance',
                                      value: formatScientific(
                                        selectedBranchPoint.codim2.tolerance,
                                        4
                                      ),
                                    },
                                    { label: 'Method', value: selectedBranchPoint.codim2.method },
                                    {
                                      label: 'Source segment',
                                      value: selectedBranchPoint.codim2.source_segment.join(' to '),
                                    },
                                    {
                                      label: 'Source test values',
                                      value: selectedBranchPoint.codim2.source_test_values
                                        .map((value) => formatScientific(value, 4))
                                        .join(' to '),
                                    },
                                  ]}
                                />
                                {selectedBranchPoint.codim2.coefficients.length > 0 ? (
                                  <>
                                    <h4 className="inspector-subheading">
                                      Normal-form coefficients
                                    </h4>
                                    <InspectorMetrics
                                      rows={selectedBranchPoint.codim2.coefficients.map(
                                        (coefficient) => ({
                                          label: coefficient.name,
                                          value: formatScientific(coefficient.value, 4),
                                        })
                                      )}
                                    />
                                  </>
                                ) : null}
                                {typeof selectedBranchPoint.codim2.conditioning
                                  .bordered_condition_number === 'number' ||
                                typeof selectedBranchPoint.codim2.conditioning
                                  .jacobian_condition_number === 'number' ? (
                                  <>
                                    <h4 className="inspector-subheading">Conditioning</h4>
                                    <InspectorMetrics
                                      rows={[
                                        ...(typeof selectedBranchPoint.codim2.conditioning
                                          .bordered_condition_number === 'number'
                                          ? [
                                              {
                                                label: 'Bordered condition number',
                                                value: formatScientific(
                                                  selectedBranchPoint.codim2.conditioning
                                                    .bordered_condition_number,
                                                  4
                                                ),
                                              },
                                            ]
                                          : []),
                                        ...(typeof selectedBranchPoint.codim2.conditioning
                                          .jacobian_condition_number === 'number'
                                          ? [
                                              {
                                                label: 'Jacobian condition number',
                                                value: formatScientific(
                                                  selectedBranchPoint.codim2.conditioning
                                                    .jacobian_condition_number,
                                                  4
                                                ),
                                              },
                                            ]
                                          : []),
                                      ]}
                                    />
                                  </>
                                ) : null}
                                {(selectedBranchPoint.codim2.branch_switches?.length ?? 0) > 0 ? (
                                  <>
                                    <h4 className="inspector-subheading">
                                      Adjacent cycle curves
                                    </h4>
                                    <InspectorMetrics
                                      rows={selectedBranchPoint.codim2.branch_switches?.map(
                                        (branchSwitch) => ({
                                          label: branchSwitch.target,
                                          value: branchSwitch.available
                                            ? `Available${
                                                typeof branchSwitch.target_auxiliary === 'number'
                                                  ? ` (auxiliary ${formatScientific(
                                                      branchSwitch.target_auxiliary,
                                                      4
                                                    )})`
                                                  : ''
                                              }`
                                            : `Unavailable${
                                                branchSwitch.reason
                                                  ? ` — ${branchSwitch.reason}`
                                                  : ''
                                              }`,
                                        })
                                      ) ?? []}
                                    />
                                  </>
                                ) : null}
                                {selectedBranchPoint.codim2.certification ? (
                                  <>
                                    <h4 className="inspector-subheading">Certification</h4>
                                    <InspectorMetrics
                                      rows={[
                                        {
                                          label: 'Defining conditions',
                                          value: selectedBranchPoint.codim2.certification
                                            .defining_conditions_verified
                                            ? 'Verified'
                                            : 'Not verified',
                                        },
                                        {
                                          label: 'Higher-order nondegeneracy',
                                          value: selectedBranchPoint.codim2.certification
                                            .nondegeneracy_evaluated
                                            ? selectedBranchPoint.codim2.certification.nondegenerate
                                              ? 'Verified nondegenerate'
                                              : 'Failed or degenerate'
                                            : 'Not evaluated',
                                        },
                                        ...(selectedBranchPoint.codim2.certification.reason
                                          ? [
                                              {
                                                label: 'Certification note',
                                                value:
                                                  selectedBranchPoint.codim2.certification.reason,
                                              },
                                            ]
                                          : []),
                                      ]}
                                    />
                                  </>
                                ) : null}
                                {(selectedBranchPoint.codim2_events?.length ?? 0) > 1 ? (
                                  <>
                                    <h4 className="inspector-subheading">
                                      Simultaneous codimension-two events
                                    </h4>
                                    <InspectorMetrics
                                      rows={(selectedBranchPoint.codim2_events ?? [])
                                        .slice(1)
                                        .map((event) => ({
                                          label: event.type,
                                          value: `${event.refined ? 'Refined' : 'Detected'}; ${
                                            event.test_function
                                          }=${formatScientific(event.test_function_value, 4)}${
                                            event.certification?.reason
                                              ? ` — ${event.certification.reason}`
                                              : ''
                                          }`,
                                        }))}
                                    />
                                  </>
                                ) : null}
                                {selectedBranchPoint.codim2.refined &&
                                !selectedBranchPoint.codim2.candidate &&
                                (selectedBranchPoint.codim2.type === 'GeneralizedHopf' ||
                                  selectedBranchPoint.codim2.type === 'BogdanovTakens') ? (
                                  <>
                                    <h4 className="inspector-subheading">Branch switching</h4>
                                    <div className="inspector-actions">
                                      {selectedBranchPoint.codim2.type === 'GeneralizedHopf' ? (
                                        <button
                                          type="button"
                                          onClick={() => void handleCreateCodim2Branch('LimitPointCycle')}
                                          data-testid="codim2-switch-lpc"
                                        >
                                          Start LPC curve
                                        </button>
                                      ) : (
                                        <>
                                          <label>
                                            Homoclinic method
                                            <select
                                              value={btHomoclinicDraft.discretization}
                                              onChange={(event) =>
                                                setBtHomoclinicDraft((prev) => ({
                                                  ...prev,
                                                  discretization:
                                                    event.target.value === 'shooting'
                                                      ? 'shooting'
                                                      : 'collocation',
                                                }))
                                              }
                                              data-testid="codim2-switch-homoclinic-method"
                                            >
                                              <option value="collocation">
                                                Orthogonal Collocation
                                              </option>
                                              <option value="shooting">Standard Shooting</option>
                                            </select>
                                          </label>
                                          {btHomoclinicDraft.discretization === 'shooting' ? (
                                            <>
                                              <label>
                                                Shooting intervals
                                                <input
                                                  type="number"
                                                  min={1}
                                                  step={1}
                                                  value={btHomoclinicDraft.shootingIntervals}
                                                  onChange={(event) =>
                                                    setBtHomoclinicDraft((prev) => ({
                                                      ...prev,
                                                      shootingIntervals: event.target.value,
                                                    }))
                                                  }
                                                  data-testid="codim2-switch-homoclinic-shooting-intervals"
                                                />
                                              </label>
                                              <label>
                                                Integration steps per segment
                                                <input
                                                  type="number"
                                                  min={1}
                                                  step={1}
                                                  value={
                                                    btHomoclinicDraft.integrationStepsPerSegment
                                                  }
                                                  onChange={(event) =>
                                                    setBtHomoclinicDraft((prev) => ({
                                                      ...prev,
                                                      integrationStepsPerSegment:
                                                        event.target.value,
                                                    }))
                                                  }
                                                  data-testid="codim2-switch-homoclinic-integration-steps"
                                                />
                                              </label>
                                            </>
                                          ) : (
                                            <CollocationAdaptivityFields
                                              draft={btHomoclinicDraft}
                                              onChange={(patch) =>
                                                setBtHomoclinicDraft((prev) => ({
                                                  ...prev,
                                                  ...patch,
                                                }))
                                              }
                                              testIdPrefix="codim2-switch-homoclinic"
                                            />
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => void handleCreateCodim2Branch('Fold')}
                                            data-testid="codim2-switch-fold"
                                          >
                                            Start fold curve
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void handleCreateCodim2Branch('Hopf')}
                                            data-testid="codim2-switch-hopf"
                                          >
                                            Start Hopf curve
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void handleCreateCodim2Branch('Homoclinic', {
                                                discretization: btHomoclinicDraft.discretization,
                                                collocationAdaptivity:
                                                  btHomoclinicDraft.discretization === 'collocation'
                                                    ? buildCollocationAdaptivitySettings(
                                                        btHomoclinicDraft
                                                      ) ?? undefined
                                                    : undefined,
                                                shootingIntervals:
                                                  btHomoclinicDraft.discretization === 'shooting'
                                                    ? Number(
                                                        btHomoclinicDraft.shootingIntervals
                                                      )
                                                    : undefined,
                                                integrationStepsPerSegment:
                                                  btHomoclinicDraft.discretization === 'shooting'
                                                    ? Number(
                                                        btHomoclinicDraft.integrationStepsPerSegment
                                                      )
                                                    : undefined,
                                              })
                                            }
                                            data-testid="codim2-switch-homoclinic"
                                          >
                                            Start homoclinic (
                                            {btHomoclinicDraft.discretization})
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </>
                                ) : null}
                              </>
                            ) : null}
                            <div className="inspector-subheading-row">
                              <h4 className="inspector-subheading">Parameters</h4>
                              {selectedBranchPointParams.length > 0 ? (
                                <button
                                  type="button"
                                  className="inspector-inline-button"
                                  onClick={() =>
                                    void writeClipboardText(
                                      formatPointValues(selectedBranchPointParams)
                                    )
                                  }
                                >
                                  Copy
                                </button>
                              ) : null}
                            </div>
                            <InspectorMetrics
                              rows={systemDraft.paramNames.map((name, index) => ({
                                label: name || `p${index + 1}`,
                                value: formatNumber(
                                  selectedBranchPointParams[index] ?? Number.NaN,
                                  6
                                ),
                              }))}
                            />
                            <div className="inspector-subheading-row">
                              <h4 className="inspector-subheading">State</h4>
                              {selectedBranchPointState.length > 0 ? (
                                <button
                                  type="button"
                                  className="inspector-inline-button"
                                  onClick={() =>
                                    void writeClipboardText(
                                      formatPointValues(selectedBranchPointState)
                                    )
                                  }
                                >
                                  Copy
                                </button>
                              ) : null}
                            </div>
                            <InspectorMetrics
                              rows={frozenVariableHeaderNames.map((name, index) => ({
                                label: name,
                                value: formatNumber(
                                  selectedBranchPointState[index] ?? Number.NaN,
                                  6
                                ),
                              }))}
                            />
                            {branchCyclePoints ? (
                              <>
                                <div className="inspector-subheading-row">
                                  <h4 className="inspector-subheading">Cycle points</h4>
                                  {branchCyclePoints.length > 0 ? (
                                    <button
                                      type="button"
                                      className="inspector-inline-button"
                                      onClick={() =>
                                        void writeClipboardText(
                                          branchCyclePoints
                                            .map((point) => formatPointValues(point))
                                            .join('\n')
                                        )
                                      }
                                    >
                                      Copy
                                    </button>
                                  ) : null}
                                </div>
                                {branchCyclePoints.length > 0 ? (
                                  <div
                                    className="orbit-preview__table"
                                    role="region"
                                    aria-label="Cycle point data"
                                  >
                                    <table className="orbit-preview__table-grid">
                                      <thead>
                                        <tr>
                                          <th>#</th>
                                          {frozenVariableHeaderNames.map((name, index) => (
                                            <th key={`branch-cycle-col-${index}`}>
                                              {name}
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {branchCyclePoints.map((point, rowIndex) => (
                                          <tr key={`branch-cycle-row-${rowIndex}`}>
                                            <td>{rowIndex}</td>
                                            {frozenVariableHeaderNames.map((_, varIndex) => (
                                              <td
                                                key={`branch-cycle-cell-${rowIndex}-${varIndex}`}
                                              >
                                                {formatFixed(
                                                  point[varIndex] ?? Number.NaN,
                                                  4
                                                )}
                                              </td>
                                            ))}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <p className="empty-state">
                                    No cycle points stored yet.
                                  </p>
                                )}
                              </>
                            ) : null}
                            <h4 className="inspector-subheading">Eigenvalues</h4>
                            {branchEigenvalues.length > 0 ? (
                              <div className="inspector-list">
                                {branchEigenPlot ? (
                                  <div className="inspector-plot">
                                    <PlotlyViewport
                                      plotId="branch-eigenvalue-plot"
                                      data={branchEigenPlot.data}
                                      layout={branchEigenPlot.layout}
                                      testId="branch-eigenvalue-plot"
                                    />
                                  </div>
                                ) : null}
                                <InspectorMetrics
                                  rows={branchEigenvalues.map((ev, index) => ({
                                    label: `λ${index + 1}`,
                                    value: isDiscreteMap
                                      ? `${formatNumberSafe(ev.re)} + ${formatNumberSafe(ev.im)}i (${formatPolarValue(ev)})`
                                      : `${formatNumberSafe(ev.re)} + ${formatNumberSafe(ev.im)}i`,
                                  }))}
                                />
                              </div>
                            ) : (
                              <p className="empty-state">
                                No eigenvalues stored for this point.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="empty-state">Select a point to inspect.</p>
                        )}
                          </div>
                        </InspectorSubDisclosure>
                      </div>
                    </InspectorDisclosure>
                  </>
                )}
  </>
}
