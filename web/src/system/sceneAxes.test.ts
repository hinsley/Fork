import { describe, expect, it } from 'vitest'
import {
  defaultSceneAxisVariables,
  maxSceneAxisCount,
  resolveSceneAxisCount,
  resolveSceneAxisIndices,
  resolveSceneAxisSelection,
} from './sceneAxes'

describe('scene axis helpers', () => {
  it('computes default axis counts by system dimension', () => {
    expect(maxSceneAxisCount(['x'])).toBe(1)
    expect(maxSceneAxisCount(['x', 'y'])).toBe(2)
    expect(maxSceneAxisCount(['x', 'y', 'z'])).toBe(3)
    expect(maxSceneAxisCount(['x', 'y', 'z', 'w'])).toBe(3)

    expect(defaultSceneAxisVariables(['x'])).toEqual(['x'])
    expect(defaultSceneAxisVariables(['x', 'y'])).toEqual(['x', 'y'])
    expect(defaultSceneAxisVariables(['x', 'y', 'z', 'w'])).toEqual(['x', 'y', 'z'])
  })

  it('normalizes legacy object-shaped axis selections', () => {
    const vars = ['x', 'y', 'z', 'w']
    const legacy = { x: 'w', y: 'x', z: 'y' }
    expect(resolveSceneAxisSelection(vars, legacy)).toEqual(['w', 'x', 'y'])
    expect(resolveSceneAxisSelection(vars, legacy, 2)).toEqual(['w', 'x'])
  })

  it('deduplicates and clamps repeated axis choices', () => {
    const vars = ['x', 'y', 'z']
    expect(resolveSceneAxisSelection(vars, ['x', 'x', 'x'])).toEqual(['x', 'y', 'z'])
    expect(resolveSceneAxisSelection(vars, ['z', 'z'], 2)).toEqual(['z', 'x'])
  })

  it('recovers from invalid variable names', () => {
    const vars = ['x', 'y', 'z']
    expect(resolveSceneAxisSelection(vars, ['q'])).toEqual(['x'])
    expect(resolveSceneAxisSelection(vars, ['x', 'q'])).toEqual(['x', 'y'])
    expect(resolveSceneAxisSelection(vars, ['q', 'x', 'q'])).toEqual(['x', 'y', 'z'])
    expect(resolveSceneAxisIndices(vars, ['q', 'x'])).toEqual([0, 1])
    expect(resolveSceneAxisCount(vars, ['q', 'x'])).toBe(2)
  })
})
