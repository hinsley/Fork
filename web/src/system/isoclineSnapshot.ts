import type { IsoclineComputedSnapshot } from './types'

export function buildIsoclineSnapshotSignature(
  snapshot: IsoclineComputedSnapshot
): string {
  return JSON.stringify({
    source: snapshot.source,
    expression: snapshot.expression,
    level: snapshot.level,
    axes: snapshot.axes,
    frozenState: snapshot.frozenState,
    parameters: snapshot.parameters,
    frozenEquationContext: snapshot.subsystemSnapshot?.frozenEquationContext ?? null,
    frozenContextParameterName:
      snapshot.subsystemSnapshot?.frozenContextParameterName ?? null,
  })
}
