import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import type { HeteroclinicInclinationFrame } from '../../../../system/types'

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

/** Homoclinic / heteroclinic event diagnostics and codimension-two refinement data. */
export function BranchPointDiagnostics({ scope }: { scope: InspectorSelectionController }) {
  const { InspectorMetrics, formatScientific, selectedBranchPoint } = scope
  if (!selectedBranchPoint) return null
  return (
    <>
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
        </>
      ) : null}
    </>
  )
}
