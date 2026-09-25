import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { formatContinuationParameterDisplayLabel } from '../../../../system/subsystemGateway'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'
import { validateStepSizes } from './stepSizeValidation'
import { StepSizeError } from './StepSizeError'

export function LimitCycleCodim1CurveWorkflow({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    InspectorDisclosure,
    branch,
    branchParams,
    codim1ParamOptions,
    continuationParameterCount,
    existingBranchNames,
    formatNumber,
    handleCreateLimitCycleCodim1Curve,
    limitCycleCodim1Curve,
    limitCycleCodim1CurveOptions,
    limitCycleCodim1CurveDraft,
    limitCycleCodim1CurveError,
    parseNumber,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setLimitCycleCodim1CurveDraft,
    setLimitCycleCodim1CurveTarget,
    showLimitCycleCodim1CurveContinuation,
    suggestDefaultName,
    systemDraft,
  } = scope
  const limitCycleCodim1CurveStepIssues = validateStepSizes(limitCycleCodim1CurveDraft)

  if (!branch || !showLimitCycleCodim1CurveContinuation || !limitCycleCodim1Curve) {
    return null
  }

  const nameKind =
    limitCycleCodim1Curve.type === 'LimitPointCycle'
      ? 'lpcCurve'
      : limitCycleCodim1Curve.type === 'PeriodDoubling'
        ? 'pdCurve'
        : 'nsCurve'

  return (
    <InspectorDisclosure
      key={`${selectionKey}-limit-cycle-codim1-curve`}
      title={`${limitCycleCodim1Curve.label} Curve`}
      testId="limit-cycle-codim1-curve-toggle"
      defaultOpen={false}
      actionOnly
    >
      <div className="inspector-section">
        {runDisabled ? (
          <div className="field-warning">Apply valid system changes first.</div>
        ) : null}
        {continuationParameterCount < 2 ? (
          <p className="field-warning">Needs a second parameter.</p>
        ) : null}
        <h4 className="inspector-subheading">{`${limitCycleCodim1Curve.label} curve`}</h4>
        <label>
          Target curve
          <select
            value={limitCycleCodim1Curve.type}
            onChange={(event) =>
              setLimitCycleCodim1CurveTarget(
                event.target.value as typeof limitCycleCodim1Curve.type
              )
            }
            data-testid="limit-cycle-codim1-curve-target"
          >
            {limitCycleCodim1CurveOptions.map((option) => (
              <option key={option.type} value={option.type}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Curve name
          <input
            value={limitCycleCodim1CurveDraft.name}
            onChange={(event) =>
              setLimitCycleCodim1CurveDraft((prev) => ({
                ...prev,
                name: event.target.value,
              }))
            }
            placeholder={suggestDefaultName(nameKind, {
              sourceName: branch.name,
              existingNames: existingBranchNames,
            })}
            data-testid="limit-cycle-codim1-curve-name"
          />
        </label>
        <label>
          Second parameter
          <select
            value={limitCycleCodim1CurveDraft.param2Name}
            onChange={(event) =>
              setLimitCycleCodim1CurveDraft((prev) => ({
                ...prev,
                param2Name: event.target.value,
              }))
            }
            disabled={
              codim1ParamOptions.length === 0 || branch.branchType !== 'limit_cycle'
            }
            data-testid="limit-cycle-codim1-curve-param2"
          >
            {codim1ParamOptions.map((name) => {
              const idx = systemDraft.paramNames.indexOf(name)
              const branchValue =
                branchParams.length === systemDraft.paramNames.length
                  ? branchParams[idx]
                  : undefined
              const fallbackValue = parseNumber(systemDraft.params[idx] ?? '')
              const value = branchValue ?? fallbackValue
              return (
                <option key={name} value={name}>
                  {`${formatContinuationParameterDisplayLabel(name)} (current: ${formatNumber(value ?? Number.NaN, 6)})`}
                </option>
              )
            })}
          </select>
        </label>
        <label>
          Direction
          <select
            value={limitCycleCodim1CurveDraft.forward ? 'forward' : 'backward'}
            onChange={(event) =>
              setLimitCycleCodim1CurveDraft((prev) => ({
                ...prev,
                forward: event.target.value === 'forward',
              }))
            }
            data-testid="limit-cycle-codim1-curve-direction"
          >
            <option value="forward">→ Increasing</option>
            <option value="backward">← Decreasing</option>
          </select>
        </label>
        <label>
          Initial step size
          <input
            type="number"
            value={limitCycleCodim1CurveDraft.stepSize}
            aria-invalid={limitCycleCodim1CurveStepIssues.stepSize || undefined}
            onChange={(event) =>
              setLimitCycleCodim1CurveDraft((prev) => ({
                ...prev,
                stepSize: event.target.value,
              }))
            }
            data-testid="limit-cycle-codim1-curve-step-size"
          />
        </label>
        <label>
          Min step size
          <input
            type="number"
            value={limitCycleCodim1CurveDraft.minStepSize}
            aria-invalid={limitCycleCodim1CurveStepIssues.minStepSize || undefined}
            onChange={(event) =>
              setLimitCycleCodim1CurveDraft((prev) => ({
                ...prev,
                minStepSize: event.target.value,
              }))
            }
            data-testid="limit-cycle-codim1-curve-min-step-size"
          />
        </label>
        <label>
          Max step size
          <input
            type="number"
            value={limitCycleCodim1CurveDraft.maxStepSize}
            aria-invalid={limitCycleCodim1CurveStepIssues.maxStepSize || undefined}
            onChange={(event) =>
              setLimitCycleCodim1CurveDraft((prev) => ({
                ...prev,
                maxStepSize: event.target.value,
              }))
            }
            data-testid="limit-cycle-codim1-curve-max-step-size"
          />
        </label>
        <StepSizeError issues={limitCycleCodim1CurveStepIssues} testId="limit-cycle-codim1-curve-step-error" />
        <label>
          Max points
          <input
            type="number"
            value={limitCycleCodim1CurveDraft.maxSteps}
            onChange={(event) =>
              setLimitCycleCodim1CurveDraft((prev) => ({
                ...prev,
                maxSteps: event.target.value,
              }))
            }
            data-testid="limit-cycle-codim1-curve-max-steps"
          />
        </label>
        <label>
          Corrector steps
          <input
            type="number"
            value={limitCycleCodim1CurveDraft.correctorSteps}
            onChange={(event) =>
              setLimitCycleCodim1CurveDraft((prev) => ({
                ...prev,
                correctorSteps: event.target.value,
              }))
            }
            data-testid="limit-cycle-codim1-curve-corrector-steps"
          />
        </label>
        <label>
          Corrector tolerance
          <input
            type="number"
            value={limitCycleCodim1CurveDraft.correctorTolerance}
            onChange={(event) =>
              setLimitCycleCodim1CurveDraft((prev) => ({
                ...prev,
                correctorTolerance: event.target.value,
              }))
            }
            data-testid="limit-cycle-codim1-curve-corrector-tolerance"
          />
        </label>
        <label>
          Step tolerance
          <input
            type="number"
            value={limitCycleCodim1CurveDraft.stepTolerance}
            onChange={(event) =>
              setLimitCycleCodim1CurveDraft((prev) => ({
                ...prev,
                stepTolerance: event.target.value,
              }))
            }
            data-testid="limit-cycle-codim1-curve-step-tolerance"
          />
        </label>
        <CollocationAdaptivityFields
          draft={limitCycleCodim1CurveDraft}
          onChange={(patch) =>
            setLimitCycleCodim1CurveDraft((prev) => ({ ...prev, ...patch }))
          }
          testIdPrefix="limit-cycle-codim1-curve"
        />
        {limitCycleCodim1CurveError ? (
          <div className="field-error">{limitCycleCodim1CurveError}</div>
        ) : null}
        <button
          className="inspector-primary-action"
          onClick={handleCreateLimitCycleCodim1Curve}
          disabled={
            limitCycleCodim1CurveStepIssues.invalid ||
            runDisabled ||
            !selectedBranchPoint ||
            (branch.branchType !== 'limit_cycle' &&
              branch.branchType !== 'lpc_curve' &&
              branch.branchType !== 'pd_curve' &&
              branch.branchType !== 'ns_curve') ||
            continuationParameterCount < 2
          }
          data-testid="limit-cycle-codim1-curve-submit"
        >
          Continue
        </button>
      </div>
    </InspectorDisclosure>
  )
}
