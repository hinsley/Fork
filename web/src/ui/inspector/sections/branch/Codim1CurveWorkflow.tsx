import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'

export function Codim1CurveWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    branch,
    branchParams,
    codim1ParamOptions,
    continuationParameterCount,
    existingBranchNames,
    foldCurveDraft,
    foldCurveError,
    formatNumber,
    handleCreateFoldCurve,
    handleCreateHopfCurve,
    handleCreateNSCurve,
    hopfCurveDraft,
    hopfCurveError,
    hopfCurveLabel,
    hopfOmega,
    nsCurveDraft,
    nsCurveError,
    nsCurveLabel,
    parseNumber,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setFoldCurveDraft,
    setHopfCurveDraft,
    setNSCurveDraft,
    showCodim1CurveContinuations,
    showFoldCurveContinuation,
    showHopfCurveContinuation,
    showNSCurveContinuation,
    suggestDefaultName,
    systemDraft,
  } = scope
  if (!branch) return null
  return <>
{showCodim1CurveContinuations ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-codim1-curves`}
                    title="Codim-1 Curve Continuations"
                    testId="codim1-curve-toggle"
                    defaultOpen={false}
                    actionOnly
                  >
                    <div className="inspector-section">
                      {runDisabled ? (
                        <div className="field-warning">
                          Apply valid system changes before continuing.
                        </div>
                      ) : null}
                      {continuationParameterCount < 2 ? (
                        <p className="empty-state">
                          Add a second parameter to enable codim-1 continuation.
                        </p>
                      ) : null}
                      {showFoldCurveContinuation ? (
                        <>
                          <h4 className="inspector-subheading">Fold curve</h4>
                          <label>
                            Curve name
                            <input
                              value={foldCurveDraft.name}
                              onChange={(event) =>
                                setFoldCurveDraft((prev) => ({
                                  ...prev,
                                  name: event.target.value,
                                }))
                              }
                              placeholder={suggestDefaultName('foldCurve', {
                                sourceName: branch.name,
                                existingNames: existingBranchNames,
                              })}
                              data-testid="fold-curve-name"
                            />
                          </label>
                          <label>
                            Second parameter
                            <select
                              value={foldCurveDraft.param2Name}
                              onChange={(event) =>
                                setFoldCurveDraft((prev) => ({
                                  ...prev,
                                  param2Name: event.target.value,
                                }))
                              }
                              disabled={codim1ParamOptions.length === 0}
                              data-testid="fold-curve-param2"
                            >
                              {codim1ParamOptions.map((name) => {
                                const idx = systemDraft.paramNames.indexOf(name)
                                const branchValue =
                                  branchParams.length === systemDraft.paramNames.length
                                    ? branchParams[idx]
                                    : undefined
                                const fallbackValue = parseNumber(systemDraft.params[idx] ?? '')
                                const value = branchValue ?? fallbackValue
                                const label = `${name} (current: ${formatNumber(
                                  value ?? Number.NaN,
                                  6
                                )})`
                                return (
                                  <option key={name} value={name}>
                                    {label}
                                  </option>
                                )
                              })}
                            </select>
                          </label>
                          <label>
                            Direction
                            <select
                              value={foldCurveDraft.forward ? 'forward' : 'backward'}
                              onChange={(event) =>
                                setFoldCurveDraft((prev) => ({
                                  ...prev,
                                  forward: event.target.value === 'forward',
                                }))
                              }
                              data-testid="fold-curve-direction"
                            >
                              <option value="forward">Forward</option>
                              <option value="backward">Backward</option>
                            </select>
                          </label>
                          <label>
                            Initial step size
                            <input
                              type="number"
                              value={foldCurveDraft.stepSize}
                              onChange={(event) =>
                                setFoldCurveDraft((prev) => ({
                                  ...prev,
                                  stepSize: event.target.value,
                                }))
                              }
                              data-testid="fold-curve-step-size"
                            />
                          </label>
                          <label>
                            Min step size
                            <input
                              type="number"
                              value={foldCurveDraft.minStepSize}
                              onChange={(event) =>
                                setFoldCurveDraft((prev) => ({
                                  ...prev,
                                  minStepSize: event.target.value,
                                }))
                              }
                              data-testid="fold-curve-min-step-size"
                            />
                          </label>
                          <label>
                            Max step size
                            <input
                              type="number"
                              value={foldCurveDraft.maxStepSize}
                              onChange={(event) =>
                                setFoldCurveDraft((prev) => ({
                                  ...prev,
                                  maxStepSize: event.target.value,
                                }))
                              }
                              data-testid="fold-curve-max-step-size"
                            />
                          </label>
                          <label>
                            Max points
                            <input
                              type="number"
                              value={foldCurveDraft.maxSteps}
                              onChange={(event) =>
                                setFoldCurveDraft((prev) => ({
                                  ...prev,
                                  maxSteps: event.target.value,
                                }))
                              }
                              data-testid="fold-curve-max-steps"
                            />
                          </label>
                          <label>
                            Corrector steps
                            <input
                              type="number"
                              value={foldCurveDraft.correctorSteps}
                              onChange={(event) =>
                                setFoldCurveDraft((prev) => ({
                                  ...prev,
                                  correctorSteps: event.target.value,
                                }))
                              }
                              data-testid="fold-curve-corrector-steps"
                            />
                          </label>
                          <label>
                            Corrector tolerance
                            <input
                              type="number"
                              value={foldCurveDraft.correctorTolerance}
                              onChange={(event) =>
                                setFoldCurveDraft((prev) => ({
                                  ...prev,
                                  correctorTolerance: event.target.value,
                                }))
                              }
                              data-testid="fold-curve-corrector-tolerance"
                            />
                          </label>
                          <label>
                            Step tolerance
                            <input
                              type="number"
                              value={foldCurveDraft.stepTolerance}
                              onChange={(event) =>
                                setFoldCurveDraft((prev) => ({
                                  ...prev,
                                  stepTolerance: event.target.value,
                                }))
                              }
                              data-testid="fold-curve-step-tolerance"
                            />
                          </label>
                          {foldCurveError ? (
                            <div className="field-error">{foldCurveError}</div>
                          ) : null}
                          <button
                            onClick={handleCreateFoldCurve}
                            disabled={
                              runDisabled ||
                              !selectedBranchPoint ||
                              branch.branchType !== 'equilibrium'
                            }
                            data-testid="fold-curve-submit"
                          >
                            Continue Fold Curve
                          </button>
                        </>
                      ) : showHopfCurveContinuation ? (
                        <>
                          <h4 className="inspector-subheading">{`${hopfCurveLabel} curve`}</h4>
                          <label>
                            Curve name
                            <input
                              value={hopfCurveDraft.name}
                              onChange={(event) =>
                                setHopfCurveDraft((prev) => ({
                                  ...prev,
                                  name: event.target.value,
                                }))
                              }
                              placeholder={suggestDefaultName('hopfCurve', {
                                sourceName: branch.name,
                                existingNames: existingBranchNames,
                              })}
                              data-testid="hopf-curve-name"
                            />
                          </label>
                          <label>
                            Second parameter
                            <select
                              value={hopfCurveDraft.param2Name}
                              onChange={(event) =>
                                setHopfCurveDraft((prev) => ({
                                  ...prev,
                                  param2Name: event.target.value,
                                }))
                              }
                              disabled={codim1ParamOptions.length === 0}
                              data-testid="hopf-curve-param2"
                            >
                              {codim1ParamOptions.map((name) => {
                                const idx = systemDraft.paramNames.indexOf(name)
                                const branchValue =
                                  branchParams.length === systemDraft.paramNames.length
                                    ? branchParams[idx]
                                    : undefined
                                const fallbackValue = parseNumber(systemDraft.params[idx] ?? '')
                                const value = branchValue ?? fallbackValue
                                const label = `${name} (current: ${formatNumber(
                                  value ?? Number.NaN,
                                  6
                                )})`
                                return (
                                  <option key={name} value={name}>
                                    {label}
                                  </option>
                                )
                              })}
                            </select>
                          </label>
                          <label>
                            {`${hopfCurveLabel} frequency (ω)`}
                            <input
                              value={formatNumber(hopfOmega ?? Number.NaN, 6)}
                              disabled
                              data-testid="hopf-curve-omega"
                            />
                          </label>
                          <label>
                            Direction
                            <select
                              value={hopfCurveDraft.forward ? 'forward' : 'backward'}
                              onChange={(event) =>
                                setHopfCurveDraft((prev) => ({
                                  ...prev,
                                  forward: event.target.value === 'forward',
                                }))
                              }
                              data-testid="hopf-curve-direction"
                            >
                              <option value="forward">Forward</option>
                              <option value="backward">Backward</option>
                            </select>
                          </label>
                          <label>
                            Initial step size
                            <input
                              type="number"
                              value={hopfCurveDraft.stepSize}
                              onChange={(event) =>
                                setHopfCurveDraft((prev) => ({
                                  ...prev,
                                  stepSize: event.target.value,
                                }))
                              }
                              data-testid="hopf-curve-step-size"
                            />
                          </label>
                          <label>
                            Min step size
                            <input
                              type="number"
                              value={hopfCurveDraft.minStepSize}
                              onChange={(event) =>
                                setHopfCurveDraft((prev) => ({
                                  ...prev,
                                  minStepSize: event.target.value,
                                }))
                              }
                              data-testid="hopf-curve-min-step-size"
                            />
                          </label>
                          <label>
                            Max step size
                            <input
                              type="number"
                              value={hopfCurveDraft.maxStepSize}
                              onChange={(event) =>
                                setHopfCurveDraft((prev) => ({
                                  ...prev,
                                  maxStepSize: event.target.value,
                                }))
                              }
                              data-testid="hopf-curve-max-step-size"
                            />
                          </label>
                          <label>
                            Max points
                            <input
                              type="number"
                              value={hopfCurveDraft.maxSteps}
                              onChange={(event) =>
                                setHopfCurveDraft((prev) => ({
                                  ...prev,
                                  maxSteps: event.target.value,
                                }))
                              }
                              data-testid="hopf-curve-max-steps"
                            />
                          </label>
                          <label>
                            Corrector steps
                            <input
                              type="number"
                              value={hopfCurveDraft.correctorSteps}
                              onChange={(event) =>
                                setHopfCurveDraft((prev) => ({
                                  ...prev,
                                  correctorSteps: event.target.value,
                                }))
                              }
                              data-testid="hopf-curve-corrector-steps"
                            />
                          </label>
                          <label>
                            Corrector tolerance
                            <input
                              type="number"
                              value={hopfCurveDraft.correctorTolerance}
                              onChange={(event) =>
                                setHopfCurveDraft((prev) => ({
                                  ...prev,
                                  correctorTolerance: event.target.value,
                                }))
                              }
                              data-testid="hopf-curve-corrector-tolerance"
                            />
                          </label>
                          <label>
                            Step tolerance
                            <input
                              type="number"
                              value={hopfCurveDraft.stepTolerance}
                              onChange={(event) =>
                                setHopfCurveDraft((prev) => ({
                                  ...prev,
                                  stepTolerance: event.target.value,
                                }))
                              }
                              data-testid="hopf-curve-step-tolerance"
                            />
                          </label>
                          {hopfCurveError ? (
                            <div className="field-error">{hopfCurveError}</div>
                          ) : null}
                          <button
                            onClick={handleCreateHopfCurve}
                            disabled={
                              runDisabled ||
                              !selectedBranchPoint ||
                              branch.branchType !== 'equilibrium'
                            }
                            data-testid="hopf-curve-submit"
                          >
                            {`Continue ${hopfCurveLabel} Curve`}
                          </button>
                        </>
                      ) : showNSCurveContinuation ? (
                        <>
                          <h4 className="inspector-subheading">{`${nsCurveLabel} curve`}</h4>
                          <label>
                            Curve name
                            <input
                              value={nsCurveDraft.name}
                              onChange={(event) =>
                                setNSCurveDraft((prev) => ({
                                  ...prev,
                                  name: event.target.value,
                                }))
                              }
                              placeholder={suggestDefaultName('nsCurve', {
                                sourceName: branch.name,
                                existingNames: existingBranchNames,
                              })}
                              data-testid="ns-curve-name"
                            />
                          </label>
                          <label>
                            Second parameter
                            <select
                              value={nsCurveDraft.param2Name}
                              onChange={(event) =>
                                setNSCurveDraft((prev) => ({
                                  ...prev,
                                  param2Name: event.target.value,
                                }))
                              }
                              disabled={codim1ParamOptions.length === 0}
                              data-testid="ns-curve-param2"
                            >
                              {codim1ParamOptions.map((name) => {
                                const idx = systemDraft.paramNames.indexOf(name)
                                const branchValue =
                                  branchParams.length === systemDraft.paramNames.length
                                    ? branchParams[idx]
                                    : undefined
                                const fallbackValue = parseNumber(systemDraft.params[idx] ?? '')
                                const value = branchValue ?? fallbackValue
                                const label = `${name} (current: ${formatNumber(
                                  value ?? Number.NaN,
                                  6
                                )})`
                                return (
                                  <option key={name} value={name}>
                                    {label}
                                  </option>
                                )
                              })}
                            </select>
                          </label>
                          <label>
                            {`${nsCurveLabel} frequency (ω)`}
                            <input
                              value={formatNumber(hopfOmega ?? Number.NaN, 6)}
                              disabled
                              data-testid="ns-curve-omega"
                            />
                          </label>
                          <label>
                            Direction
                            <select
                              value={nsCurveDraft.forward ? 'forward' : 'backward'}
                              onChange={(event) =>
                                setNSCurveDraft((prev) => ({
                                  ...prev,
                                  forward: event.target.value === 'forward',
                                }))
                              }
                              data-testid="ns-curve-direction"
                            >
                              <option value="forward">Forward</option>
                              <option value="backward">Backward</option>
                            </select>
                          </label>
                          <label>
                            Initial step size
                            <input
                              type="number"
                              value={nsCurveDraft.stepSize}
                              onChange={(event) =>
                                setNSCurveDraft((prev) => ({
                                  ...prev,
                                  stepSize: event.target.value,
                                }))
                              }
                              data-testid="ns-curve-step-size"
                            />
                          </label>
                          <label>
                            Min step size
                            <input
                              type="number"
                              value={nsCurveDraft.minStepSize}
                              onChange={(event) =>
                                setNSCurveDraft((prev) => ({
                                  ...prev,
                                  minStepSize: event.target.value,
                                }))
                              }
                              data-testid="ns-curve-min-step-size"
                            />
                          </label>
                          <label>
                            Max step size
                            <input
                              type="number"
                              value={nsCurveDraft.maxStepSize}
                              onChange={(event) =>
                                setNSCurveDraft((prev) => ({
                                  ...prev,
                                  maxStepSize: event.target.value,
                                }))
                              }
                              data-testid="ns-curve-max-step-size"
                            />
                          </label>
                          <label>
                            Max points
                            <input
                              type="number"
                              value={nsCurveDraft.maxSteps}
                              onChange={(event) =>
                                setNSCurveDraft((prev) => ({
                                  ...prev,
                                  maxSteps: event.target.value,
                                }))
                              }
                              data-testid="ns-curve-max-steps"
                            />
                          </label>
                          <label>
                            Corrector steps
                            <input
                              type="number"
                              value={nsCurveDraft.correctorSteps}
                              onChange={(event) =>
                                setNSCurveDraft((prev) => ({
                                  ...prev,
                                  correctorSteps: event.target.value,
                                }))
                              }
                              data-testid="ns-curve-corrector-steps"
                            />
                          </label>
                          <label>
                            Corrector tolerance
                            <input
                              type="number"
                              value={nsCurveDraft.correctorTolerance}
                              onChange={(event) =>
                                setNSCurveDraft((prev) => ({
                                  ...prev,
                                  correctorTolerance: event.target.value,
                                }))
                              }
                              data-testid="ns-curve-corrector-tolerance"
                            />
                          </label>
                          <label>
                            Step tolerance
                            <input
                              type="number"
                              value={nsCurveDraft.stepTolerance}
                              onChange={(event) =>
                                setNSCurveDraft((prev) => ({
                                  ...prev,
                                  stepTolerance: event.target.value,
                                }))
                              }
                              data-testid="ns-curve-step-tolerance"
                            />
                          </label>
                          {nsCurveError ? (
                            <div className="field-error">{nsCurveError}</div>
                          ) : null}
                          <button
                            onClick={handleCreateNSCurve}
                            disabled={
                              runDisabled ||
                              !selectedBranchPoint ||
                              branch.branchType !== 'equilibrium'
                            }
                            data-testid="ns-curve-submit"
                          >
                            {`Continue ${nsCurveLabel} Curve`}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </InspectorDisclosure>
                ) : null}
  </>
}
