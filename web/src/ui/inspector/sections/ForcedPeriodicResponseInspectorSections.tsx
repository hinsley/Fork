import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { formatContinuationParameterDisplayLabel } from '../../../system/subsystemGateway'

export function ForcedPeriodicResponseInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    InspectorDisclosure,
    StateTable,
    continuationDraft,
    continuationError,
    continuationParameterLabels,
    forcedPeriodicResponse,
    forcedPeriodicResponseDraft,
    forcedPeriodicResponseError,
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
        title="Solve forced response"
        testId="forced-response-solver-toggle"
        defaultOpen
        actionOnly
      >
        <div className="inspector-section">
          {!forcing ? (
            <div className="field-error">Declare periodic forcing in the system editor.</div>
          ) : null}
          {scope.currentFrozenEquationContext ? (
            <div className="field-warning">Unfreeze the equation forcing context (needs live t/n).</div>
          ) : null}
          <StateTable
            title="Strobe guess"
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
            {systemDraft.type === 'flow' ? 'Phase fraction' : 'Phase residue'}
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
            Multiple
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
            <label title="Integration steps per forcing period">
              Steps / period
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
            className="inspector-primary-action"
            onClick={handleSolveForcedPeriodicResponse}
            disabled={runDisabled || !forcing || Boolean(scope.currentFrozenEquationContext)}
            data-testid="forced-response-solve-submit"
          >
            Solve
          </button>
        </div>
      </InspectorDisclosure>

      {solution ? (
        <InspectorDisclosure
          key={`${selectionKey}-forced-response-continuation`}
          title="Continue forced response"
          testId="forced-response-continuation-toggle"
          actionOnly
        >
          <div className="inspector-section">
            <label>
              Branch
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
              Parameter
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
                <option value="forward">→ Increasing</option>
                <option value="backward">← Decreasing</option>
              </select>
            </label>
            <label>
              Step
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
              Max pts
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
              className="inspector-primary-action"
              onClick={handleCreateForcedPeriodicResponseBranch}
              disabled={
                continuationParameterLabels.length === 0 ||
                scope.forcedPeriodicResponseStale ||
                Boolean(scope.currentFrozenEquationContext)
              }
              data-testid="forced-response-branch-submit"
            >
              Continue
            </button>
          </div>
        </InspectorDisclosure>
      ) : null}
    </>
  )
}
