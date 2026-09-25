import { describe, expect, it } from 'vitest'
import {
  bifurcationCode,
  bifurcationTone,
  classifyEquilibrium,
  stabilityTolerance,
  unstableDimension,
} from './stability'

describe('classifyEquilibrium', () => {
  it('classifies flow equilibria', () => {
    expect(classifyEquilibrium([{ re: -1, im: 1 }, { re: -1, im: -1 }], 'flow').label).toBe(
      'stable focus'
    )
    expect(classifyEquilibrium([{ re: 1, im: 0 }, { re: 2, im: 0 }], 'flow').label).toBe(
      'unstable node'
    )
    const saddle = classifyEquilibrium([{ re: 1, im: 0 }, { re: -2, im: 0 }], 'flow')
    expect(saddle.kind).toBe('saddle')
    expect(saddle.label).toBe('saddle 1u')
    expect(
      classifyEquilibrium(
        [{ re: 1, im: 0 }, { re: -2, im: 3 }, { re: -2, im: -3 }],
        'flow'
      ).label
    ).toBe('saddle-focus 1u')
    expect(classifyEquilibrium([{ re: 0, im: 1 }, { re: 0, im: -1 }], 'flow').kind).toBe(
      'nonhyperbolic'
    )
    expect(classifyEquilibrium([], 'flow').kind).toBe('unknown')
  })

  it('classifies map fixed points by modulus', () => {
    expect(classifyEquilibrium([{ re: 0.5, im: 0 }], 'map').label).toBe('stable')
    expect(classifyEquilibrium([{ re: -1.5, im: 0 }], 'map').label).toBe('unstable')
    expect(classifyEquilibrium([{ re: 1.5, im: 0 }, { re: 0.2, im: 0 }], 'map').label).toBe(
      'saddle 1u'
    )
  })

  it('counts unstable dimensions', () => {
    expect(unstableDimension([{ re: 1, im: 0 }, { re: -1, im: 0 }], 'flow')).toBe(1)
    expect(unstableDimension(undefined, 'flow')).toBeNull()
  })
})

describe('stability tolerance', () => {
  // Lorenz C+ at the located Hopf point (rho ≈ 24.74): the pair's real part is
  // locator noise next to |λ3| ≈ 13.7.
  const lorenzHopf = [
    { re: 4.16564e-7, im: 9.62453 },
    { re: 4.16564e-7, im: -9.62453 },
    { re: -13.6667, im: 0 },
  ]

  it('scales with the spectral radius for flows and is fixed for maps', () => {
    expect(stabilityTolerance(lorenzHopf, 'flow')).toBeCloseTo(1.36667e-4, 8)
    expect(stabilityTolerance([{ re: 1e-6, im: 0 }], 'flow')).toBe(1e-8)
    expect(stabilityTolerance([{ re: 1000, im: 0 }], 'map')).toBe(1e-5)
  })

  it('reads a located Hopf point as non-hyperbolic', () => {
    const result = classifyEquilibrium(lorenzHopf, 'flow')
    expect(result.kind).toBe('nonhyperbolic')
    expect(result.label).toBe('non-hyperbolic')
    expect(result.center).toBe(2)
    expect(unstableDimension(lorenzHopf, 'flow')).toBe(0)
  })

  it('reads a located fold as non-hyperbolic', () => {
    const fold = [{ re: -3e-6, im: 0 }, { re: -2.5, im: 0 }]
    expect(classifyEquilibrium(fold, 'flow').kind).toBe('nonhyperbolic')
  })

  it('still counts genuinely unstable points', () => {
    const past = [
      { re: 0.012, im: 9.7 },
      { re: 0.012, im: -9.7 },
      { re: -13.7, im: 0 },
    ]
    expect(classifyEquilibrium(past, 'flow').label).toBe('saddle-focus 2u')
    expect(unstableDimension(past, 'flow')).toBe(2)
    // Small but resolvable instability in a slow system.
    expect(unstableDimension([{ re: 2e-7, im: 0 }, { re: -1e-3, im: 0 }], 'flow')).toBe(1)
  })

  it('keeps a large map multiplier from hiding a nearby unstable one', () => {
    expect(
      classifyEquilibrium([{ re: 1000, im: 0 }, { re: 1.001, im: 0 }], 'map').label
    ).toBe('unstable')
    expect(
      classifyEquilibrium([{ re: 1.000001, im: 0 }, { re: 0.5, im: 0 }], 'map').kind
    ).toBe('nonhyperbolic')
  })

  it('honours an explicit tolerance', () => {
    expect(unstableDimension(lorenzHopf, 'flow', 1e-8)).toBe(2)
  })
})

describe('bifurcation codes', () => {
  it('maps tags to short codes', () => {
    expect(bifurcationCode('Hopf')).toBe('H')
    expect(bifurcationCode('Hopf', 'map')).toBe('NS')
    expect(bifurcationCode('Fold')).toBe('LP')
    expect(bifurcationCode('PeriodDoubling')).toBe('PD')
    expect(bifurcationCode('BogdanovTakens')).toBe('BT')
    expect(bifurcationCode('HomoclinicNeutralSaddle')).toBe('NNS')
    expect(bifurcationCode('None')).toBe('')
  })

  it('assigns tones', () => {
    expect(bifurcationTone('LP')).toBe('fold')
    expect(bifurcationTone('H')).toBe('hopf')
    expect(bifurcationTone('PD')).toBe('flip')
    expect(bifurcationTone('BT')).toBe('codim2')
  })
})
