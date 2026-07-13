import { useMemo, useState } from 'react'
import type { Codim2BranchCreationRequest } from '../../../../state/appState'
import type { ContinuationSettings } from '../../../../system/types'
import { isCliSafeName } from '../../../../utils/naming'
import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { normalFormSummaryRows, supportsNormalFormWorkflow } from './normalFormPresentation'

const DEFAULT_SETTINGS: ContinuationSettings = {
  step_size: 0.01,
  min_step_size: 1e-5,
  max_step_size: 0.1,
  max_steps: 120,
  corrector_steps: 10,
  corrector_tolerance: 1e-8,
  step_tolerance: 1e-8,
}

type Codim2Target = Extract<
  Codim2BranchCreationRequest['target'],
  'Fold' | 'Hopf' | 'NeimarkSacker'
>

function finitePositive(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function finiteNonzero(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && Math.abs(parsed) > 1e-10 ? parsed : null
}

export function NormalFormWorkflow({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const codim2Type = scope.selectedBranchPoint?.codim2?.type ?? 'none'
  return (
    <NormalFormWorkflowContent
      key={`${scope.selectionKey}-${scope.branchPointIndex ?? 'none'}-${codim2Type}`}
      scope={scope}
    />
  )
}

function NormalFormWorkflowContent({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    InspectorDisclosure,
    InspectorMetrics,
    branch,
    branchPointIndex,
    existingBranchNames,
    onComputeNormalFormAtPoint,
    onCreateCodim2BranchFromPoint,
    onCreatePeriodicBranchFromPoint,
    runDisabled,
    selectedBranchPoint,
    selectedNodeId,
    selectionKey,
    suggestDefaultName,
    systemDraft,
  } = scope
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [amplitude, setAmplitude] = useState('0.05')
  const [forward, setForward] = useState(true)
  const [target, setTarget] = useState<Codim2Target>(() =>
    scope.selectedBranchPoint?.codim2?.type === 'ZeroHopf' ? 'Fold' : 'Hopf'
  )
  const [orientation, setOrientation] = useState<'Negative' | 'Positive'>('Positive')
  const [mode, setMode] = useState<1 | 2>(1)
  const [perturbation, setPerturbation] = useState('0.02')
  const [ntst, setNtst] = useState('20')
  const [ncol, setNcol] = useState('4')
  const [tolerance, setTolerance] = useState('1e-7')

  const codim2Type = selectedBranchPoint?.codim2?.type
  const eligible = Boolean(
    branch &&
      selectedBranchPoint &&
      supportsNormalFormWorkflow(
        systemDraft.type,
        branch.branchType,
        selectedBranchPoint.stability,
        codim2Type
      )
  )
  const branchProvenance = branch?.data.normal_form_provenance
  const branchProvenanceIsFromCurrentBranch = Boolean(
    branchProvenance &&
      [
        branchProvenance.source_branch_id,
        branchProvenance.source_branch_name,
        branchProvenance.source_branch,
      ].some(
        (sourceBranch) =>
          sourceBranch === selectedNodeId || sourceBranch === branch?.name
      )
  )
  const provenance =
    selectedBranchPoint?.normal_form ??
    (!branchProvenanceIsFromCurrentBranch ? branchProvenance : undefined)
  const normalForm = provenance?.normal_form
  const pointNormalForm = selectedBranchPoint?.normal_form?.normal_form
  const zeroHopfHasNsCoefficient = selectedBranchPoint?.codim2?.coefficients?.find(
    (entry) => entry.name === 'has_ns'
  )?.value
  const zeroHopfNsUnavailable =
    (normalForm?.type === 'ZeroHopf' && !normalForm.has_neimark_sacker) ||
    (codim2Type === 'ZeroHopf' &&
      Number.isFinite(zeroHopfHasNsCoefficient) &&
      (zeroHopfHasNsCoefficient ?? 0) <= 0)
  const isPeriodicSource =
    systemDraft.type === 'flow' && branch?.branchType === 'limit_cycle'
  const hasPersistentMesh =
    branch?.data.branch_type?.type === 'LimitCycle' &&
    Array.isArray(branch.data.branch_type.normalized_mesh) &&
    branch.data.branch_type.normalized_mesh.length === branch.data.branch_type.ntst + 1
  const genericPeriodicBp = Boolean(
    isPeriodicSource &&
      selectedBranchPoint?.stability === 'BranchPoint' &&
      pointNormalForm?.type === 'BranchPoint' &&
      (pointNormalForm.kind === 'Transcritical' || pointNormalForm.kind === 'Pitchfork')
  )
  const codim2Source = codim2Type === 'ZeroHopf' || codim2Type === 'DoubleHopf'
  const codim2SwitchEligible = Boolean(
    codim2Source &&
      selectedBranchPoint?.codim2?.refined &&
      !selectedBranchPoint.codim2.candidate
  )
  const unavailableTargetSet = useMemo(
    () => new Set(
      selectedBranchPoint?.codim2?.branch_switches
        ?.filter((entry) => !entry.available)
        .map((entry) => entry.target) ?? []
    ),
    [selectedBranchPoint?.codim2?.branch_switches]
  )
  const availableTargets = useMemo<Codim2Target[]>(
    () =>
      codim2Type === 'ZeroHopf'
        ? ['Fold', 'Hopf', 'NeimarkSacker']
        : ['Hopf', 'NeimarkSacker'],
    [codim2Type]
  )

  const targetUnavailable =
    unavailableTargetSet.has(target) ||
    (target === 'NeimarkSacker' && zeroHopfNsUnavailable)
  const resolvedTarget = targetUnavailable
    ? availableTargets.find(
        (entry) =>
          !unavailableTargetSet.has(entry) &&
          !(entry === 'NeimarkSacker' && zeroHopfNsUnavailable)
      ) ?? target
    : target

  if (!branch || !selectedBranchPoint || branchPointIndex === null || !selectedNodeId) {
    return null
  }
  if (!eligible && !provenance) return null

  const suggestedName = suggestDefaultName('continuationBranch', {
    sourceName: branch.name,
    pointIndex: branchPointIndex,
    existingNames: existingBranchNames,
  })

  const validateName = (): string | null => {
    const candidate = name.trim() || suggestedName
    if (!candidate) return null
    if (!isCliSafeName(candidate)) {
      setError('Branch names must be alphanumeric with underscores only.')
      return null
    }
    return candidate
  }

  const handlePeriodicSwitch = async () => {
    if (runDisabled || !hasPersistentMesh) return
    const branchName = validateName()
    const parsedAmplitude = finiteNonzero(amplitude)
    if (!branchName) return
    if (parsedAmplitude === null) {
      setError('Predictor amplitude must be finite and nonzero.')
      return
    }
    setError(null)
    await onCreatePeriodicBranchFromPoint({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      name: branchName,
      amplitude: parsedAmplitude,
      settings: DEFAULT_SETTINGS,
      forward,
    })
  }

  const handleCodim2Switch = async () => {
    if (runDisabled) return
    const branchName = validateName()
    const parsedPerturbation = finitePositive(perturbation)
    const parsedNtst = finitePositive(ntst)
    const parsedNcol = finitePositive(ncol)
    const parsedTolerance = finitePositive(tolerance)
    if (!branchName) return
    if (
      parsedPerturbation === null ||
      parsedNtst === null ||
      parsedNcol === null ||
      parsedTolerance === null
    ) {
      setError('Perturbation, mesh sizes, and tolerance must be positive.')
      return
    }
    if (
      resolvedTarget === 'NeimarkSacker' &&
      (!Number.isInteger(parsedNtst) ||
        parsedNtst < 2 ||
        !Number.isInteger(parsedNcol) ||
        parsedNcol < 1)
    ) {
      setError(
        'Periodic NS mesh intervals must be an integer of at least 2, and collocation degree must be a positive integer.'
      )
      return
    }
    setError(null)
    await onCreateCodim2BranchFromPoint({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      target: resolvedTarget,
      name: branchName,
      perturbation: parsedPerturbation,
      ntst: parsedNtst,
      ncol: parsedNcol,
      tolerance: parsedTolerance,
      orientation,
      mode,
      cycleAmplitude: parsedPerturbation,
      settings: DEFAULT_SETTINGS,
      forward,
    })
  }

  const unavailableReasons = selectedBranchPoint.codim2?.branch_switches
    ?.filter((entry) => !entry.available && entry.reason)
    .map((entry) => `${entry.target}: ${entry.reason}`) ?? []

  return (
    <InspectorDisclosure
      key={`${selectionKey}-normal-form`}
      title="Normal Form & Branch Switching"
      testId="normal-form-workflow-toggle"
      defaultOpen={Boolean(provenance)}
      actionOnly
    >
      <div className="inspector-section">
        {runDisabled ? (
          <div className="field-warning">Apply valid system changes before computing.</div>
        ) : null}
        {isPeriodicSource && !hasPersistentMesh ? (
          <div className="field-warning" data-testid="normal-form-mesh-warning">
            This legacy cycle has no persistent collocation mesh. Recontinue it before
            computing or switching a normal form.
          </div>
        ) : null}
        {eligible ? (
          <button
            type="button"
            className="primary"
            disabled={runDisabled || (isPeriodicSource && !hasPersistentMesh)}
            data-testid="compute-normal-form"
            onClick={() =>
              onComputeNormalFormAtPoint({
                branchId: selectedNodeId,
                pointIndex: branchPointIndex,
              })
            }
          >
            Compute Normal Form
          </button>
        ) : null}
      </div>

      {provenance && normalForm ? (
        <div className="inspector-section" data-testid="normal-form-readout">
          <h4 className="inspector-subheading">Computed normal form</h4>
          <InspectorMetrics rows={normalFormSummaryRows(normalForm)} />
          <InspectorMetrics
            rows={[
              { label: 'Source', value: provenance.source_kind },
              { label: 'Source point', value: provenance.source_point_index },
              ...(provenance.map_iterations
                ? [{ label: 'Map iterations', value: provenance.map_iterations }]
                : []),
              ...(provenance.normalized_mesh
                ? [{ label: 'Mesh intervals', value: provenance.normalized_mesh.length - 1 }]
                : []),
            ]}
          />
        </div>
      ) : null}

      {unavailableReasons.length > 0 ? (
        <div className="inspector-section" data-testid="normal-form-unavailable-reasons">
          <h4 className="inspector-subheading">Unavailable targets</h4>
          <ul>
            {unavailableReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      ) : null}
      {zeroHopfNsUnavailable ? (
        <div className="field-warning" data-testid="zero-hopf-ns-unavailable">
          Periodic NS switching is unavailable because this Zero-Hopf normal form
          fails the required sign condition.
        </div>
      ) : null}

      {genericPeriodicBp ? (
        <div className="inspector-section" data-testid="periodic-bp-switch-form">
          <h4 className="inspector-subheading">Secondary periodic branch</h4>
          <label>
            Branch name
            <input
              value={name}
              placeholder={suggestedName}
              data-testid="periodic-bp-branch-name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Predictor amplitude
            <input
              type="number"
              value={amplitude}
              data-testid="periodic-bp-amplitude"
              onChange={(event) => setAmplitude(event.target.value)}
            />
          </label>
          <label>
            Direction
            <select value={forward ? 'forward' : 'backward'} onChange={(event) => setForward(event.target.value === 'forward')}>
              <option value="forward">Forward</option>
              <option value="backward">Backward</option>
            </select>
          </label>
          <button
            type="button"
            className="primary"
            data-testid="switch-periodic-bp"
            disabled={runDisabled || !hasPersistentMesh}
            onClick={handlePeriodicSwitch}
          >
            Correct & Continue Secondary Branch
          </button>
        </div>
      ) : null}

      {codim2SwitchEligible ? (
        <div className="inspector-section" data-testid="equilibrium-codim2-switch-form">
          <h4 className="inspector-subheading">Target branch</h4>
          <label>
            Branch name
            <input value={name} placeholder={suggestedName} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Target
            <select data-testid="codim2-target" value={resolvedTarget} onChange={(event) => setTarget(event.target.value as Codim2Target)}>
              {availableTargets.map((entry) => (
                <option
                  key={entry}
                  value={entry}
                  disabled={
                    unavailableTargetSet.has(entry) ||
                    (entry === 'NeimarkSacker' && zeroHopfNsUnavailable)
                  }
                >
                  {entry === 'NeimarkSacker' ? 'Periodic NS curve' : `${entry} curve`}
                </option>
              ))}
            </select>
          </label>
          {codim2Type === 'DoubleHopf' ? (
            <label>
              Hopf mode
              <select data-testid="codim2-mode" value={mode} onChange={(event) => setMode(Number(event.target.value) as 1 | 2)}>
                <option value={1}>Mode 1</option>
                <option value={2}>Mode 2</option>
              </select>
            </label>
          ) : null}
          {resolvedTarget !== 'NeimarkSacker' ? (
            <label>
              Orientation
              <select data-testid="codim2-orientation" value={orientation} onChange={(event) => setOrientation(event.target.value as 'Negative' | 'Positive')}>
                <option value="Positive">Positive</option>
                <option value="Negative">Negative</option>
              </select>
            </label>
          ) : null}
          <label>
            {resolvedTarget === 'NeimarkSacker' ? 'Cycle amplitude' : 'Predictor perturbation'}
            <input type="number" value={perturbation} onChange={(event) => setPerturbation(event.target.value)} />
          </label>
          {resolvedTarget === 'NeimarkSacker' ? (
            <>
              <label>
                Mesh intervals
                <input data-testid="codim2-ntst" type="number" value={ntst} onChange={(event) => setNtst(event.target.value)} />
              </label>
              <label>
                Collocation degree
                <input data-testid="codim2-ncol" type="number" value={ncol} onChange={(event) => setNcol(event.target.value)} />
              </label>
              <label>
                Seed tolerance
                <input type="number" value={tolerance} onChange={(event) => setTolerance(event.target.value)} />
              </label>
            </>
          ) : null}
          <label>
            Direction
            <select value={forward ? 'forward' : 'backward'} onChange={(event) => setForward(event.target.value === 'forward')}>
              <option value="forward">Forward</option>
              <option value="backward">Backward</option>
            </select>
          </label>
          <button
            type="button"
            className="primary"
            data-testid="switch-equilibrium-codim2"
            disabled={runDisabled}
            onClick={handleCodim2Switch}
          >
            Correct & Continue Target Branch
          </button>
        </div>
      ) : null}
      {error ? <div className="field-error">{error}</div> : null}
    </InspectorDisclosure>
  )
}
