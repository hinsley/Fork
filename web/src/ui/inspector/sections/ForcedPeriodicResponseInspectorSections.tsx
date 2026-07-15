import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { formatContinuationParameterDisplayLabel } from '../../../system/subsystemGateway'

export function ForcedPeriodicResponseInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    InspectorDisclosure,
    InspectorMetrics,
    StateTable,
    continuationDraft,
    continuationError,
    continuationParameterLabels,
    forcedPeriodicResponse,
    forcedPeriodicResponseDraft,
    forcedPeriodicResponseError,
    forcedPeriodicResponseStale,
    formatComplexValue,
    formatNumber,
    formatScientific,
    handleCreateForcedPeriodicResponseBranch,
    handleSolveForcedPeriodicResponse,
    runDisabled,
    selectionKey,
    setContinuationDraft,
    setForcedPeriodicResponseDraft,
    systemDraft,
  } = scope

  if (!forcedPeriodicResponse) return null
  const solution = forcedPeriodicResponse.solution
  const forcing = scope.system.config.periodicForcing

  return (
    <>
      <InspectorDisclosure
        key={`${selectionKey}-forced-response-solver`}
        title="Forced Response Solver"
        testId="forced-response-solver-toggle"
        defaultOpen
        actionOnly
      >
        <div className="inspector-section">
          {!forcing ? (
            <div className="field-error">Declare periodic forcing in the system editor.</div>
          ) : null}
          {scope.currentFrozenEquationContext ? (
            <div className="field-warning">
              Stroboscopic analysis requires live t/n. Unfreeze the equation forcing context.
            </div>
          ) : null}
          <StateTable
            title="Strobe state guess"
            varNames={systemDraft.varNames}
            values={forcedPeriodicResponseDraft.initialGuess}
            onChange={(initialGuess) =>
              setForcedPeriodicResponseDraft((previous) => ({ ...previous, initialGuess }))
            }
            onCopy={() => {}}
            onPaste={() => {}}
            testIdPrefix="forced-response-guess"
          />
          <label>
            {systemDraft.type === 'flow' ? 'Strobe phase fraction' : 'Strobe phase residue'}
            <input
              type="number"
              step={systemDraft.type === 'map' ? 1 : 'any'}
              value={forcedPeriodicResponseDraft.phase}
              onChange={(event) =>
                setForcedPeriodicResponseDraft((previous) => ({
                  ...previous,
                  phase: event.target.value,
                }))
              }
              data-testid="forced-response-phase"
            />
          </label>
          <label>
            Response multiple
            <input
              type="number"
              min={1}
              step={1}
              value={forcedPeriodicResponseDraft.responseMultiple}
              onChange={(event) =>
                setForcedPeriodicResponseDraft((previous) => ({
                  ...previous,
                  responseMultiple: event.target.value,
                }))
              }
              data-testid="forced-response-multiple"
            />
          </label>
          {systemDraft.type === 'flow' ? (
            <label>
              Integration steps per forcing period
              <input
                type="number"
                min={1}
                step={1}
                value={forcedPeriodicResponseDraft.stepsPerForcingPeriod}
                onChange={(event) =>
                  setForcedPeriodicResponseDraft((previous) => ({
                    ...previous,
                    stepsPerForcingPeriod: event.target.value,
                  }))
                }
                data-testid="forced-response-period-steps"
              />
            </label>
          ) : null}
          <label>
            Newton steps
            <input
              type="number"
              min={1}
              step={1}
              value={forcedPeriodicResponseDraft.maxSteps}
              onChange={(event) =>
                setForcedPeriodicResponseDraft((previous) => ({
                  ...previous,
                  maxSteps: event.target.value,
                }))
              }
              data-testid="forced-response-newton-steps"
            />
          </label>
          <label>
            Damping
            <input
              type="number"
              value={forcedPeriodicResponseDraft.dampingFactor}
              onChange={(event) =>
                setForcedPeriodicResponseDraft((previous) => ({
                  ...previous,
                  dampingFactor: event.target.value,
                }))
              }
              data-testid="forced-response-damping"
            />
          </label>
          <label>
            Tolerance
            <input
              type="number"
              value={forcedPeriodicResponseDraft.tolerance}
              onChange={(event) =>
                setForcedPeriodicResponseDraft((previous) => ({
                  ...previous,
                  tolerance: event.target.value,
                }))
              }
              data-testid="forced-response-tolerance"
            />
          </label>
          {forcedPeriodicResponseError ? (
            <div className="field-error">{forcedPeriodicResponseError}</div>
          ) : null}
          <button
            onClick={handleSolveForcedPeriodicResponse}
            disabled={runDisabled || !forcing || Boolean(scope.currentFrozenEquationContext)}
            data-testid="forced-response-solve-submit"
          >
            Solve forced response
          </button>
        </div>
      </InspectorDisclosure>

      {solution ? (
        <InspectorDisclosure
          key={`${selectionKey}-forced-response-data`}
          title="Forced Response Data"
          testId="forced-response-data-toggle"
          defaultOpen
        >
          <div className="inspector-section">
            {forcedPeriodicResponseStale ? (
              <div className="field-warning" data-testid="forced-response-stale">
                This result is stale. Rerun it with the current forcing declaration,
                strobe settings, parameters, and frozen variables.
              </div>
            ) : null}
            <InspectorMetrics
              rows={[
                { label: 'Forcing period', value: formatNumber(solution.forcing_period, 8) },
                {
                  label: 'Response period',
                  value: formatNumber(
                    solution.forcing_period * solution.response_multiple,
                    8
                  ),
                },
                { label: 'Response multiple', value: solution.response_multiple },
                { label: 'Residual', value: formatScientific(solution.residual_norm, 6) },
                { label: 'Newton iterations', value: solution.iterations },
                { label: 'Trajectory points', value: solution.cycle_points.length },
              ]}
            />
            {solution.minimal_response_multiple < solution.response_multiple ? (
              <div className="field-warning" data-testid="forced-response-lower-period">
                This solution has the lower response multiple{' '}
                {solution.minimal_response_multiple}.
              </div>
            ) : null}
            <h4 className="inspector-subheading">Multipliers</h4>
            {solution.multipliers.length > 0 ? (
              <div className="inspector-list">
                {solution.multipliers.map((multiplier, index) => (
                  <span key={`forced-multiplier-${index}`}>
                    μ{index + 1} = {formatComplexValue(multiplier)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="empty-state">No multipliers returned.</p>
            )}
          </div>
        </InspectorDisclosure>
      ) : null}

      {solution ? (
        <InspectorDisclosure
          key={`${selectionKey}-forced-response-continuation`}
          title="Forced Response Continuation"
          testId="forced-response-continuation-toggle"
          actionOnly
        >
          <div className="inspector-section">
            <label>
              Branch name
              <input
                value={continuationDraft.name}
                onChange={(event) =>
                  setContinuationDraft((previous) => ({
                    ...previous,
                    name: event.target.value,
                  }))
                }
                data-testid="forced-response-branch-name"
              />
            </label>
            <label>
              Continuation parameter
              <select
                value={continuationDraft.parameterName}
                onChange={(event) =>
                  setContinuationDraft((previous) => ({
                    ...previous,
                    parameterName: event.target.value,
                  }))
                }
                data-testid="forced-response-branch-parameter"
              >
                {continuationParameterLabels.map((name) => (
                  <option key={name} value={name}>
                    {formatContinuationParameterDisplayLabel(name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Direction
              <select
                value={continuationDraft.forward ? 'forward' : 'backward'}
                onChange={(event) =>
                  setContinuationDraft((previous) => ({
                    ...previous,
                    forward: event.target.value === 'forward',
                  }))
                }
              >
                <option value="forward">Forward</option>
                <option value="backward">Backward</option>
              </select>
            </label>
            <label>
              Initial step size
              <input
                type="number"
                value={continuationDraft.stepSize}
                onChange={(event) =>
                  setContinuationDraft((previous) => ({
                    ...previous,
                    stepSize: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Max points
              <input
                type="number"
                value={continuationDraft.maxSteps}
                onChange={(event) =>
                  setContinuationDraft((previous) => ({
                    ...previous,
                    maxSteps: event.target.value,
                  }))
                }
              />
            </label>
            {continuationError ? <div className="field-error">{continuationError}</div> : null}
            <button
              onClick={handleCreateForcedPeriodicResponseBranch}
              disabled={
                continuationParameterLabels.length === 0 ||
                forcedPeriodicResponseStale ||
                Boolean(scope.currentFrozenEquationContext)
              }
              data-testid="forced-response-branch-submit"
            >
              Create branch
            </button>
          </div>
        </InspectorDisclosure>
      ) : null}
    </>
  )
}
