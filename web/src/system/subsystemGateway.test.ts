import { describe, expect, it } from 'vitest'
import type { SystemConfig } from './types'
import {
  buildReducedRunConfig,
  buildSubsystemSnapshot,
  continuationParameterOptions,
  embedReducedStateForDisplay,
  formatContinuationParameterDisplayLabel,
  formatParameterRefLabel,
  parseParameterRefLabel,
  projectStateToReduced,
  resolveRuntimeParameterName,
} from './subsystemGateway'

const BASE_SYSTEM: SystemConfig = {
  name: 'Gateway',
  equations: ['(y - x) / tau', 'x - y + I'],
  params: [2, 0.4],
  paramNames: ['tau', 'I'],
  varNames: ['x', 'y'],
  solver: 'rk4',
  type: 'flow',
}

describe('subsystemGateway', () => {
  it('builds deterministic snapshots for frozen variable configs', () => {
    const snapshotA = buildSubsystemSnapshot(BASE_SYSTEM, {
      frozenValuesByVarName: { y: 0.25 },
    })
    const snapshotB = buildSubsystemSnapshot(BASE_SYSTEM, {
      frozenValuesByVarName: { y: 0.25 },
    })

    expect(snapshotA.freeVariableNames).toEqual(['x'])
    expect(snapshotA.freeVariableIndices).toEqual([0])
    expect(snapshotA.frozenParameterNamesByVarName.y).toBeTruthy()
    expect(snapshotA.hash).toBe(snapshotB.hash)
  })

  it('projects and embeds states with frozen-variable overrides', () => {
    const snapshot = buildSubsystemSnapshot(BASE_SYSTEM, {
      frozenValuesByVarName: { y: 0.25 },
    })
    const reduced = projectStateToReduced(snapshot, [1.1, -3])
    expect(reduced).toEqual([1.1])

    const full = embedReducedStateForDisplay(snapshot, reduced)
    expect(full).toEqual([1.1, 0.25])

    const withOverride = embedReducedStateForDisplay(snapshot, reduced, {
      parameterRef: { kind: 'frozen_var', variableName: 'y' },
      paramValue: -0.5,
    })
    expect(withOverride).toEqual([1.1, -0.5])
  })

  it('rewrites equations and appends generated frozen parameters in reduced run config', () => {
    const snapshot = buildSubsystemSnapshot(BASE_SYSTEM, {
      frozenValuesByVarName: { y: -1.2 },
    })
    const reduced = buildReducedRunConfig(BASE_SYSTEM, snapshot, [3, 1.5])

    expect(reduced.varNames).toEqual(['x'])
    expect(reduced.equations).toHaveLength(1)
    expect(reduced.equations[0]).toContain(snapshot.frozenParameterNamesByVarName.y)
    expect(reduced.paramNames).toEqual([
      'tau',
      'I',
      snapshot.frozenParameterNamesByVarName.y,
    ])
    expect(reduced.params).toEqual([3, 1.5, -1.2])
  })

  it('resolves continuation parameter labels and runtime names for native and frozen refs', () => {
    const snapshot = buildSubsystemSnapshot(BASE_SYSTEM, {
      frozenValuesByVarName: { y: 0.75 },
    })
    const options = continuationParameterOptions(BASE_SYSTEM, snapshot)
    expect(options.map((entry) => entry.label)).toEqual([
      'tau',
      'I',
      'var:y',
    ])

    const nativeRef = parseParameterRefLabel(BASE_SYSTEM, snapshot, 'tau')
    const frozenRef = parseParameterRefLabel(BASE_SYSTEM, snapshot, 'var:y')
    expect(formatParameterRefLabel(nativeRef)).toBe('tau')
    expect(formatParameterRefLabel(frozenRef)).toBe('var:y')
    expect(resolveRuntimeParameterName(snapshot, nativeRef)).toBe('tau')
    expect(resolveRuntimeParameterName(snapshot, frozenRef)).toBe(
      snapshot.frozenParameterNamesByVarName.y
    )
  })

  it('rewrites frozen flow time to a continuation-capable generated parameter', () => {
    const forcedSystem: SystemConfig = {
      ...BASE_SYSTEM,
      equations: ['t + y', 'x - t'],
    }
    const snapshot = buildSubsystemSnapshot(forcedSystem, {
      frozenValuesByVarName: {},
      frozenEquationContext: { symbol: 't', value: 1.25 },
    })
    const reduced = buildReducedRunConfig(forcedSystem, snapshot)

    expect(snapshot.frozenContextParameterName).toMatch(/^fc__t/)
    expect(reduced.equations.join(' ')).not.toMatch(/\bt\b/)
    expect(reduced.equations.join(' ')).toContain(snapshot.frozenContextParameterName)
    expect(reduced.params.at(-1)).toBe(1.25)
    expect(continuationParameterOptions(forcedSystem, snapshot).map((entry) => entry.label))
      .toContain('ctx:t')

    const ref = parseParameterRefLabel(forcedSystem, snapshot, 'ctx:t')
    expect(ref).toEqual({ kind: 'frozen_context', symbol: 't' })
    expect(formatContinuationParameterDisplayLabel(formatParameterRefLabel(ref))).toBe(
      't (frozen forcing context)'
    )
    expect(resolveRuntimeParameterName(snapshot, ref)).toBe(
      snapshot.frozenContextParameterName
    )
  })

  it('freezes map iteration without exposing it as a continuous coordinate', () => {
    const forcedMap: SystemConfig = {
      ...BASE_SYSTEM,
      type: 'map',
      solver: 'discrete',
      equations: ['x + n', 'y - n'],
    }
    const snapshot = buildSubsystemSnapshot(forcedMap, {
      frozenValuesByVarName: {},
      frozenEquationContext: { symbol: 'n', value: -2 },
    })
    const reduced = buildReducedRunConfig(forcedMap, snapshot)

    expect(reduced.equations.join(' ')).not.toMatch(/\bn\b/)
    expect(reduced.params.at(-1)).toBe(-2)
    expect(continuationParameterOptions(forcedMap, snapshot).map((entry) => entry.label))
      .not.toContain('ctx:n')
  })

  it('enforces optional free-variable caps', () => {
    expect(() =>
      buildSubsystemSnapshot(
        {
          ...BASE_SYSTEM,
          varNames: ['x', 'y', 'z', 'w'],
          equations: ['0', '0', '0', '0'],
        },
        undefined,
        { maxFreeVariables: 3 }
      )
    ).toThrow(/At most 3 free variables/i)
  })
})
