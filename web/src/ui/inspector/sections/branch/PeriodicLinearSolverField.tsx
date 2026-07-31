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
    <>
      <h4 className="inspector-subheading">Linear solve</h4>
      <label>
        <input
          type="checkbox"
          checked={useDenseSolve}
          onChange={(event) => onChange(event.target.checked)}
          data-testid={testId}
        />
        Use dense solve (slower)
      </label>
      <span className="field-help">
        Unchecked uses the structured periodic corrector. If it fails, enable this option
        and rerun. Initialization and diagnostics are unchanged.
      </span>
    </>
  )
}
