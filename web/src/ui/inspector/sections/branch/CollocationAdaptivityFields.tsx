import type { CollocationAdaptivityDraft } from '../../collocationAdaptivity'

export function CollocationAdaptivityFields({
  draft,
  onChange,
  testIdPrefix,
}: {
  draft: CollocationAdaptivityDraft
  onChange: (patch: Partial<CollocationAdaptivityDraft>) => void
  testIdPrefix: string
}) {
  const enabled = draft.adaptiveCollocationEnabled ?? true

  return (
    <>
      <h4 className="inspector-subheading">Adaptive collocation mesh</h4>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange({ adaptiveCollocationEnabled: event.target.checked })}
          data-testid={`${testIdPrefix}-adaptive-collocation-enabled`}
        />
        Adapt mesh after rejected corrections
      </label>
      <label>
        <input
          type="checkbox"
          checked={draft.adaptiveRedistributionEnabled ?? true}
          onChange={(event) =>
            onChange({ adaptiveRedistributionEnabled: event.target.checked })
          }
          disabled={!enabled}
          data-testid={`${testIdPrefix}-adaptive-redistribution-enabled`}
        />
        Redistribute before adding mesh intervals
      </label>
      <label>
        Defect tolerance
        <input
          type="number"
          min={Number.EPSILON}
          step="any"
          value={draft.adaptiveDefectTolerance ?? '0.025'}
          onChange={(event) => onChange({ adaptiveDefectTolerance: event.target.value })}
          disabled={!enabled}
          data-testid={`${testIdPrefix}-adaptive-defect-tolerance`}
        />
      </label>
      <label>
        Max mesh adaptations
        <input
          type="number"
          min={0}
          step={1}
          value={draft.adaptiveMaxRefinements ?? '3'}
          onChange={(event) => onChange({ adaptiveMaxRefinements: event.target.value })}
          disabled={!enabled}
          data-testid={`${testIdPrefix}-adaptive-max-refinements`}
        />
      </label>
      <label>
        Max mesh intervals
        <input
          type="number"
          min={2}
          step={1}
          value={draft.adaptiveMaxMeshPoints ?? '512'}
          onChange={(event) => onChange({ adaptiveMaxMeshPoints: event.target.value })}
          disabled={!enabled}
          data-testid={`${testIdPrefix}-adaptive-max-mesh-points`}
        />
      </label>
    </>
  )
}
