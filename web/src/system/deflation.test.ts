import { describe, expect, it } from 'vitest'
import { equilibriumDeflationTargets } from './deflation'

describe('equilibrium deflation configuration', () => {
  it('migrates a legacy shared parameter pair onto every selected target', () => {
    expect(
      equilibriumDeflationTargets({
        targetObjectIds: ['fixed-1', 'cycle-2'],
        exponent: 3,
        shift: 0.5,
      })
    ).toEqual([
      { targetObjectId: 'fixed-1', exponent: 3, shift: 0.5 },
      { targetObjectId: 'cycle-2', exponent: 3, shift: 0.5 },
    ])
  })

  it('preserves distinct parameter pairs from the current format', () => {
    expect(
      equilibriumDeflationTargets({
        targets: [
          { targetObjectId: 'fixed-1', exponent: 1, shift: 0 },
          { targetObjectId: 'cycle-2', exponent: 4, shift: 2 },
        ],
      })
    ).toEqual([
      { targetObjectId: 'fixed-1', exponent: 1, shift: 0 },
      { targetObjectId: 'cycle-2', exponent: 4, shift: 2 },
    ])
  })
})
