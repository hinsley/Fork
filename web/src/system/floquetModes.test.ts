import { describe, expect, it } from 'vitest'
import {
  cycleManifoldFloquetEligibility,
  liftReducedFloquetVectorsForDisplay,
  normalizeFloquetMultipliersForRendering,
  resolveTrivialFloquetModeIndex,
} from './floquetModes'
import { buildSubsystemSnapshot } from './subsystemGateway'
import type { SystemConfig } from './types'

describe('floquetModes helpers', () => {
  it('marks the credible multiplier closest to +1 as the trivial mode', () => {
    const multipliers = [
      { re: 0.1, im: 0 },
      { re: 1.002, im: -0.003 },
      { re: -0.9, im: 0 },
    ]
    expect(resolveTrivialFloquetModeIndex(multipliers)).toBe(1)
  })

  it('does not misclassify a distant complex mode as trivial', () => {
    const multipliers = [
      { re: 0.1, im: 0 },
      { re: 1.0, im: 0.2 },
    ]
    expect(resolveTrivialFloquetModeIndex(multipliers)).toBeNull()
    const normalized = normalizeFloquetMultipliersForRendering(multipliers)
    expect(normalized[1]).toEqual({ re: 1.0, im: 0.2 })
  })

  it('preserves non-finite multipliers for eligibility diagnostics', () => {
    const value = { re: Number.POSITIVE_INFINITY, im: Number.NaN }
    const normalized = normalizeFloquetMultipliersForRendering([value])
    expect(normalized[0].re).toBe(Number.POSITIVE_INFINITY)
    expect(Number.isNaN(normalized[0].im)).toBe(true)
    expect(cycleManifoldFloquetEligibility(value, 'Unstable')).toEqual({
      eligible: false,
      reason: 'non_finite',
    })
  })

  it('snaps tiny-imaginary multipliers to real for rendering', () => {
    const multipliers = [
      { re: 0, im: 5e-4 },
      { re: 0.25, im: -2e-4 },
    ]
    const normalized = normalizeFloquetMultipliersForRendering(multipliers)
    expect(normalized[0]).toEqual({ re: 0, im: 0 })
    expect(normalized[1]).toEqual({ re: 0.25, im: 0 })
  })

  it('matches cycle-manifold Floquet eligibility to core thresholds', () => {
    expect(cycleManifoldFloquetEligibility({ re: 1.2, im: 0 }, 'Unstable')).toEqual({
      eligible: true,
    })
    expect(cycleManifoldFloquetEligibility({ re: -1.2, im: 0 }, 'Unstable')).toEqual({
      eligible: true,
    })
    expect(cycleManifoldFloquetEligibility({ re: 0.8, im: 0 }, 'Stable')).toEqual({
      eligible: true,
    })
    expect(cycleManifoldFloquetEligibility({ re: -0.8, im: 0 }, 'Stable')).toEqual({
      eligible: true,
    })
    expect(cycleManifoldFloquetEligibility({ re: 1.0, im: 0 }, 'Unstable')).toEqual({
      eligible: false,
      reason: 'trivial',
    })
    expect(cycleManifoldFloquetEligibility({ re: 0.7, im: 1e-6 }, 'Stable')).toEqual({
      eligible: false,
      reason: 'complex',
    })
    expect(cycleManifoldFloquetEligibility({ re: 1.2, im: 0 }, 'Stable')).toEqual({
      eligible: false,
      reason: 'wrong_side',
    })
    expect(cycleManifoldFloquetEligibility({ re: -1.2, im: 0 }, 'Stable')).toEqual({
      eligible: false,
      reason: 'wrong_side',
    })
    expect(cycleManifoldFloquetEligibility({ re: -0.8, im: 0 }, 'Unstable')).toEqual({
      eligible: false,
      reason: 'wrong_side',
    })
  })

  it('lifts reduced Floquet vectors with zeros on frozen coordinates', () => {
    const system: SystemConfig = {
      name: 'reduced',
      equations: ['x', 'y', 'z'],
      params: [0],
      paramNames: ['p'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    const snapshot = buildSubsystemSnapshot(system, {
      frozenValuesByVarName: { y: 3 },
    })
    const lifted = liftReducedFloquetVectorsForDisplay(snapshot, [
      [
        [
          { re: 1, im: 2 },
          { re: 4, im: 5 },
        ],
      ],
    ])

    expect(lifted).toEqual([
      [
        [
          { re: 1, im: 2 },
          { re: 0, im: 0 },
          { re: 4, im: 5 },
        ],
      ],
    ])
  })

  it('leaves already lifted Floquet vectors in full-coordinate order', () => {
    const system: SystemConfig = {
      name: 'reduced',
      equations: ['x', 'y', 'z'],
      params: [0],
      paramNames: ['p'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    }
    const snapshot = buildSubsystemSnapshot(system, {
      frozenValuesByVarName: { y: 3 },
    })
    const full = [
      [
        [
          { re: 1, im: 2 },
          { re: 0, im: 0 },
          { re: 4, im: 5 },
        ],
      ],
    ]
    expect(liftReducedFloquetVectorsForDisplay(snapshot, full)).toEqual(full)
  })
})
