import { describe, expect, it } from 'vitest'
import {
  bifurcationCode,
  bifurcationTone,
  classifyEquilibrium,
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
