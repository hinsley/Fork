import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'

export function BranchDataSections({ scope }: { scope: InspectorSelectionController }) {
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
    handleJumpToBranchPoint,
    isBranchRenderTarget,
    isDiscreteMap,
    isLimitCycleBranch,
    limitCycleMesh,
    limitCycleParentId,
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
                    </InspectorDisclosure>

                    <InspectorDisclosure
                      key={`${selectionKey}-branch-points`}
                      title="Branch Navigator"
                      testId="branch-points-toggle"
                      defaultOpen={false}
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
                          onRenderLimitCycleHere={
                            branchPointIndex !== null &&
                            selectedNodeId &&
                            limitCycleParentId &&
                            onSetLimitCycleRenderTarget &&
                            !isBranchRenderTarget
                              ? () =>
                                  onSetLimitCycleRenderTarget(limitCycleParentId, {
                                    type: 'branch',
                                    branchId: selectedNodeId,
                                    pointIndex: branchPointIndex,
                                  })
                              : undefined
                          }
                        />
                        <InspectorDisclosure
                          key={`${selectionKey}-branch-point-details`}
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
                        </InspectorDisclosure>
                      </div>
                    </InspectorDisclosure>
                  </>
                ) : (
                  <>
                    <InspectorDisclosure
                      key={`${selectionKey}-branch-summary`}
                      title="Branch Summary"
                      testId="branch-summary-toggle"
                    >
                      <div className="inspector-section">
                        <InspectorMetrics
                          rows={[
                            { label: 'Type', value: formatBranchType(branch, systemDraft.type) },
                            { label: 'Parent', value: branch.parentObject },
                            { label: 'Start', value: branch.startObject },
                            { label: 'Continuation param', value: branch.parameterName },
                            { label: 'Points', value: branch.data.points.length },
                            { label: 'Bifurcations', value: branchBifurcations.length },
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
                          onRenderLimitCycleHere={
                            branchPointIndex !== null &&
                            selectedNodeId &&
                            limitCycleParentId &&
                            onSetLimitCycleRenderTarget &&
                            !isBranchRenderTarget
                              ? () =>
                                  onSetLimitCycleRenderTarget(limitCycleParentId, {
                                    type: 'branch',
                                    branchId: selectedNodeId,
                                    pointIndex: branchPointIndex,
                                  })
                              : undefined
                          }
                        />
                        <InspectorDisclosure
                          key={`${selectionKey}-branch-point-details`}
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
                        </InspectorDisclosure>
                      </div>
                    </InspectorDisclosure>
                  </>
                )}
  </>
}
