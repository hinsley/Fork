import type { Data } from 'plotly.js'
import { describe, expect, it } from 'vitest'
import { DEFAULT_RENDER } from '../../system/model'
import type { ContinuationObject, System, TreeNode } from '../../system/types'
import { applyBranchPieceAppearances } from './branchPieceAppearance'

function makeBranch(): ContinuationObject {
  return {
    type: 'continuation',
    name: 'Branch',
    systemName: 'System',
    parameterName: 'mu',
    parentObject: 'Equilibrium',
    startObject: 'Equilibrium',
    branchType: 'equilibrium',
    data: {
      points: Array.from({ length: 6 }, (_, index) => ({
        state: [index],
        param_value: index,
        stability: index === 2 ? 'Hopf' : index === 4 ? 'Fold' : 'None',
        eigenvalues: [],
      })),
      bifurcations: [2, 4],
      indices: [0, 1, 2, 3, 4, 5],
    },
    settings: {
      step_size: 0.1,
      min_step_size: 0.01,
      max_step_size: 0.2,
      max_steps: 20,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6,
    },
    timestamp: '2026-01-01T00:00:00.000Z',
  }
}

function makeNode(overrides: TreeNode['render']['continuationPieceOverrides']): TreeNode {
  return {
    id: 'branch-1',
    name: 'Branch',
    kind: 'branch',
    objectType: 'branch',
    parentId: null,
    children: [],
    visibility: true,
    expanded: false,
    render: {
      ...DEFAULT_RENDER,
      color: '#111111',
      continuationPieceOverrides: overrides,
    },
  }
}

const trace = {
  type: 'scatter',
  mode: 'lines+markers',
  uid: 'branch-1',
  x: [0, 1, 2, 3, 4, 5],
  y: [0, 1, 4, 9, 16, 25],
  customdata: [0, 1, 2, 3, 4, 5],
  line: { color: '#111111', width: 2, dash: 'solid' },
  marker: { color: '#111111', size: 5 },
} satisfies Data

describe('branch piece appearance', () => {
  it('leaves the original trace unchanged when a branch has no overrides', () => {
    const node = makeNode(undefined)
    const result = applyBranchPieceAppearances(
      [trace],
      { [node.id]: node } as System['nodes'],
      { [node.id]: makeBranch() }
    )

    expect(result).toEqual([trace])
  })

  it('splits line traces at bifurcations and styles only overridden pieces', () => {
    const node = makeNode({
      1: {
        color: '#ff0000',
        opacity: 0.4,
        lineWidth: 6,
        lineStyle: 'dotted',
        pointSize: 9,
      },
    })
    const result = applyBranchPieceAppearances(
      [trace],
      { [node.id]: node } as System['nodes'],
      { [node.id]: makeBranch() }
    )
    const pieces = result as Array<{
      x?: unknown[]
      line?: Record<string, unknown>
      marker?: Record<string, unknown>
      opacity?: number
    }>

    expect(result).toHaveLength(3)
    expect(pieces.map((piece) => piece.x)).toEqual([
      [0, 1, 2],
      [2, 3, 4],
      [4, 5],
    ])
    expect(pieces[0]?.line).toEqual(trace.line)
    expect(pieces[1]?.line).toMatchObject({
      color: '#ff0000',
      width: 6,
      dash: 'dot',
    })
    expect(pieces[1]?.marker).toMatchObject({
      color: '#ff0000',
      size: 9,
    })
    expect(pieces[1]?.opacity).toBe(0.4)
    expect(pieces[2]?.line).toEqual(trace.line)
  })
})
