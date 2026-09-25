import { InspectorSubDisclosure } from '../../selectionSession'

export function PeriodicLinearSolverField({
  useDenseSolve,
  onChange,
  testId,
}: {
  useDenseSolve: boolean
  onChange: (useDenseSolve: boolean) => void
  testId: string
}) {
  return (
    <InspectorSubDisclosure title="Linear solve" testId={`${testId}-toggle`}>
      <label title="Off: structured periodic corrector. Turn on and rerun if it fails.">
        <input
          type="checkbox"
          checked={useDenseSolve}
          onChange={(event) => onChange(event.target.checked)}
          data-testid={testId}
        />
        Use dense solve (slower)
      </label>
    </InspectorSubDisclosure>
  )
}
