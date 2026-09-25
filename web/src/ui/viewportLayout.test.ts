import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEWPORT_WEIGHT,
  resolveViewportWeight,
  splitViewportPair,
} from './viewportLayout'

describe('viewport layout weights', () => {
  it('reads stored heights as weights and falls back to the default', () => {
    expect(resolveViewportWeight({ a: 320 }, 'a')).toBe(320)
    expect(resolveViewportWeight({ a: 320 }, 'b')).toBe(DEFAULT_VIEWPORT_WEIGHT)
    expect(resolveViewportWeight({ a: Number.NaN }, 'a')).toBe(DEFAULT_VIEWPORT_WEIGHT)
    expect(resolveViewportWeight({ a: -5 }, 'a')).toBe(DEFAULT_VIEWPORT_WEIGHT)
    expect(resolveViewportWeight(undefined, 'a')).toBe(DEFAULT_VIEWPORT_WEIGHT)
  })

  it('moves weight between neighbours while keeping their total', () => {
    const next = splitViewportPair({
      heightA: 300,
      heightB: 300,
      weightA: 360,
      weightB: 360,
      delta: 100,
    })
    expect(next.weightA + next.weightB).toBeCloseTo(720)
    expect(next.weightA / next.weightB).toBeCloseTo(400 / 200)
  })

  it('never shrinks a neighbour below the minimum pane height', () => {
    const grow = splitViewportPair({
      heightA: 300,
      heightB: 300,
      weightA: 1,
      weightB: 1,
      delta: 1000,
      minHeight: 100,
    })
    expect(grow.weightA / (grow.weightA + grow.weightB)).toBeCloseTo(500 / 600)
    const shrink = splitViewportPair({
      heightA: 300,
      heightB: 300,
      weightA: 1,
      weightB: 1,
      delta: -1000,
      minHeight: 100,
    })
    expect(shrink.weightA / (shrink.weightA + shrink.weightB)).toBeCloseTo(100 / 600)
  })
})
