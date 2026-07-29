import { describe, expect, it } from 'vitest'
import { resolveClvOpacities, resolveClvRender } from './clv'

describe('resolveClvRender', () => {
  it('defaults missing opacity to one and retains per-index overrides', () => {
    const initial = resolveClvRender(
      {
        vectorIndices: [0, 1],
        colors: ['#112233', '#445566'],
        opacities: [0.25, 0.75],
      },
      2
    )
    const hidden = resolveClvRender(
      {
        ...initial,
        vectorIndices: [0],
        colors: [initial.colors[0]],
        opacities: [initial.opacities[0]],
      },
      2
    )
    const restoredOpacities = resolveClvOpacities(
      [0, 1],
      hidden.vectorIndices,
      hidden.opacities,
      hidden.opacityOverrides
    )

    expect(restoredOpacities).toEqual([0.25, 0.75])
    expect(resolveClvRender(undefined, 1).opacities).toEqual([1])
  })
})
